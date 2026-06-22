'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const { loadConfig, findGitRoot, WEBHOOK_URL, ensureGitignore } = require('./config');

function extractTicketId(branchName) {
  // 1. Try Jira-style key first: e.g. PROJ-123
  const jiraMatch = branchName.match(/([A-Z][A-Z0-9]*-\d+)/i);
  if (jiraMatch) return jiraMatch[1].toUpperCase();

  // 2. Split by slash to get the leaf segment: e.g. "feature/86exzcfcn-search" -> "86exzcfcn-search"
  const segments = branchName.split('/');
  const leaf = segments[segments.length - 1];

  // 3. Split the leaf by hyphen or underscore: e.g. "86exzcfcn-search" -> ["86exzcfcn", "search"]
  const tokens = leaf.split(/[-_]/);

  // Look for the first token that looks like a task ID:
  // - Numeric ID of length >= 8 (Asana, Monday, etc.)
  // - Alphanumeric ID of length 7-12 containing both letters and numbers, or just letters/numbers (ClickUp, Trello)
  for (const token of tokens) {
    if (/^\d{8,18}$/.test(token)) {
      return token;
    }
    if (/^[a-zA-Z0-9]{7,12}$/.test(token)) {
      return token;
    }
  }

  // Fallback: if there's only one token or the branch name itself is the ID
  if (/^[a-zA-Z0-9]{5,15}$/.test(leaf)) {
    return leaf;
  }

  return null;
}

/**
 * Build the output file path based on the configured outputDir setting.
 * Possible values:
 *   'current' → inside the git repo root (default)
 *   'parent'  → one directory above the git repo root (../)
 *   'root'    → the git repo root (same as 'current' but kept separate for clarity)
 */
function resolveOutputDir(gitRoot, outputDir) {
  switch (outputDir) {
    case 'parent':
      return path.resolve(gitRoot, '..');
    case 'root':
      return gitRoot;
    case 'current':
    default:
      return gitRoot;
  }
}

/**
 * Derive the filename from the task title and ticket key.
 * Format: <FirstWord>_<KEY>.md
 * e.g. task title "Implement user login" with key "PROJ-42" → "Implement_PROJ-42.md"
 */
function buildOutputFilename(taskTitle, ticketId) {
  if (taskTitle) {
    const firstWord = taskTitle.trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
    if (firstWord) {
      return `${firstWord}_${ticketId || 'task'}.md`;
    }
  }
  // Fallback when no task title is available
  if (ticketId) {
    return `Implementation_${ticketId}.md`;
  }
  return 'Implementation.md';
}

// ─────────────────────────────────────────────────────────────────────────────
// Synchronous TTY helpers — avoids any async libuv handles that would block
// process.exit(). Uses raw fs.openSync/readSync/closeSync on /dev/tty.
// ─────────────────────────────────────────────────────────────────────────────
function openTty() {
  try {
    return fs.openSync('/dev/tty', 'r+');
  } catch (e) {
    return -1;
  }
}

function writeTty(fd, msg) {
  try { fs.writeSync(fd, msg); } catch (e) {}
}

function readLineTty(fd) {
  // Read one character at a time until \n
  const chunks = [];
  const buf = Buffer.alloc(1);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, 1, null);
      if (n === 0) break;
      const ch = buf[0];
      if (ch === 0x0a) break; // newline
      if (ch === 0x0d) continue; // carriage return — skip
      chunks.push(ch);
    }
  } catch (e) {}
  return Buffer.from(chunks).toString('utf8').trim();
}

function askSync(ttyFd, question, options) {
  writeTty(ttyFd, question + '\n');
  options.forEach((opt, i) => writeTty(ttyFd, `  [${i + 1}] ${opt.label}\n`));
  writeTty(ttyFd, 'Enter choice [1]: ');
  const answer = readLineTty(ttyFd);
  const idx = parseInt(answer, 10) - 1;
  return (idx >= 0 && idx < options.length) ? options[idx].value : options[0].value;
}

async function promptForTask(branchName, config) {
  const API_URL = process.env.LEMAI_API_URL || 'https://api.getlem.ai';
  const headers = {
    'Content-Type': 'application/json',
    'x-sdk-key': config.apiKey
  };

  // Open /dev/tty synchronously — zero async handles, guaranteed clean exit
  const ttyFd = openTty();
  if (ttyFd < 0) return null; // No controlling terminal (CI, pipes, Windows)

  const closeTty = () => { try { fs.closeSync(ttyFd); } catch (e) {} };

  try {
    writeTty(ttyFd, 'Checking connected integrations...\n');
    let providersResponse;
    while (true) {
      try {
        providersResponse = await axios.get(`${API_URL}/api/v1/webhooks/lem/active-providers`, { headers });
        break;
      } catch (fetchErr) {
        const errorOptions = [
          { label: 'Retry checking integrations', value: 'retry' },
          { label: 'Skip / Do not link task', value: 'skip' }
        ];
        const choice = askSync(
          ttyFd,
          `⚠️  Error checking integrations: ${fetchErr.message}`,
          errorOptions
        );
        if (choice === 'retry') {
          continue;
        } else {
          writeTty(ttyFd, 'Skipped task linking.\n');
          closeTty();
          return null;
        }
      }
    }
    const providers = providersResponse.data.providers || [];

    if (providers.length === 0) {
      writeTty(ttyFd, '⚠️  No connected task integrations (Jira, Asana, Monday, ClickUp, Trello) found.\n');
      closeTty();
      return null;
    }

    let selectedProvider = null;
    let selectedTask = null;

    while (true) {
      if (!selectedProvider) {
        const providerOptions = providers.map(p => ({
          label: chalk.blue(p.toUpperCase()),
          value: p
        }));
        providerOptions.push({ label: 'Skip / Do not link task', value: 'skip' });

        const choice = askSync(ttyFd, '\nSelect a task provider to associate with this branch:', providerOptions);
        if (choice === 'skip' || !choice) {
          writeTty(ttyFd, 'Skipped task linking.\n');
          closeTty();
          return null;
        }
        selectedProvider = choice;
      }

      if (!selectedTask) {
        writeTty(ttyFd, `Fetching tasks for ${chalk.blue(selectedProvider.toUpperCase())}...\n`);
        let tasksResponse;
        try {
          tasksResponse = await axios.get(`${API_URL}/api/v1/webhooks/lem/in-progress-tasks?providerType=${selectedProvider}`, { headers });
        } catch (fetchErr) {
          const errorOptions = [
            { label: 'Retry fetching tasks', value: 'retry' },
            { label: 'Go back to provider selection', value: 'back' },
            { label: 'Skip / Do not link task', value: 'skip' }
          ];
          const choice = askSync(
            ttyFd,
            `⚠️  Error fetching tasks for ${chalk.blue(selectedProvider.toUpperCase())}: ${fetchErr.message}`,
            errorOptions
          );
          if (choice === 'retry') {
            continue;
          } else if (choice === 'back') {
            selectedProvider = null;
            continue;
          } else {
            writeTty(ttyFd, 'Skipped task linking.\n');
            closeTty();
            return null;
          }
        }
        const tasks = tasksResponse.data.tasks || [];

        if (tasks.length === 0) {
          const emptyOptions = [
            { label: 'Go back to provider selection', value: 'back' },
            { label: 'Skip / Do not link task', value: 'skip' }
          ];
          const choice = askSync(
            ttyFd,
            `⚠️  No active/in-progress tasks found for ${chalk.blue(selectedProvider.toUpperCase())}.`,
            emptyOptions
          );
          if (choice === 'back') {
            selectedProvider = null;
            continue;
          } else {
            writeTty(ttyFd, 'Skipped task linking.\n');
            closeTty();
            return null;
          }
        }

        const taskOptions = tasks.map(t => ({
          label: chalk.green(`[${t.key}] ${t.title} (${t.status || 'Active'})`),
          value: t
        }));
        taskOptions.push({ label: 'Go back to provider selection', value: 'back' });
        taskOptions.push({ label: 'Skip / Do not link task', value: 'skip' });

        const choice = askSync(ttyFd, `\nSelect an in-progress ${chalk.blue(selectedProvider.toUpperCase())} task:`, taskOptions);
        if (choice === 'back') {
          selectedProvider = null;
          continue;
        }
        if (choice === 'skip' || !choice) {
          writeTty(ttyFd, 'Skipped task linking.\n');
          closeTty();
          return null;
        }

        selectedTask = choice;
      }

      writeTty(ttyFd, `Connecting branch "${branchName}" to task "${selectedTask.key}"...\n`);
      try {
        await axios.post(`${API_URL}/api/v1/webhooks/lem/connect-branch`, {
          providerType: selectedProvider,
          taskKey: selectedTask.key,
          branchName
        }, { headers });
      } catch (connErr) {
        const errorOptions = [
          { label: 'Retry connecting branch', value: 'retry' },
          { label: 'Go back to task selection', value: 'back' },
          { label: 'Skip / Do not link task', value: 'skip' }
        ];
        const choice = askSync(
          ttyFd,
          `⚠️  Error connecting branch: ${connErr.message}`,
          errorOptions
        );
        if (choice === 'retry') {
          continue;
        } else if (choice === 'back') {
          selectedTask = null;
          continue;
        } else {
          writeTty(ttyFd, 'Skipped task linking.\n');
          closeTty();
          return null;
        }
      }

      writeTty(ttyFd, `\n✅ Branch successfully connected to task ${selectedTask.key}!\n\n`);
      closeTty();
      return selectedTask.key;
    }
  } catch (err) {
    writeTty(ttyFd, `\n❌ Error during task linking: ${err.message}\n`);
    closeTty();
    return null;
  }
}

async function checkout(branchName) {
  const config = loadConfig();

  if (!config) {
    console.log(chalk.yellow('\n⚠️  Not configured. Run: get-lem-ai setup\n'));
    return;
  }

  // ────────────────────────────────────────────────────────────
  // API Key guard — warn user and exit early if key is missing
  // ────────────────────────────────────────────────────────────
  if (!config.apiKey || !config.apiKey.trim()) {
    console.log(chalk.red('\n❌  [get-lem-ai] API key is missing!'));
    console.log(chalk.yellow('    ⚠️  Cannot process your request for implementation generation.'));
    console.log(chalk.cyan('    👉  Please run: get-lem-ai setup   (and enter your SDK API key)\n'));
    return;
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 1: Foreground — Interactive prompts, then exit cleanly.
  // The shell hook (reference-transaction) launches the background
  // generator independently via: nohup get-lem-ai checkout ... &
  // ────────────────────────────────────────────────────────────
  if (!process.env.LEMAI_BG) {
    console.log(chalk.cyan(`\n[get-lem-ai] 🚀 Branch detected: ${chalk.bold(branchName)}`));

    await promptForTask(branchName, config);

    console.log(chalk.gray(`[get-lem-ai] ⚡ Generating implementation file in background...`));
    console.log(chalk.gray(`[get-lem-ai] 🏁 Git checkout will proceed instantly.\n`));

    // Exit cleanly — the shell hook fires the background generator via nohup
    process.exit(0);
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 2: Background Process — Do the heavy lifting
  // ────────────────────────────────────────────────────────────
  ensureGitignore();
  const ticketId = extractTicketId(branchName);
  const startTime = new Date().toISOString();

  const gitRoot = findGitRoot(process.cwd()) || process.cwd();

  const log = (msg) => {
    // No-op: Do not write to log files
  };

  log(`Starting background sync for ${branchName}...`);

  const headers = { 'Content-Type': 'application/json' };
  if (config.secret) headers['Authorization'] = `Bearer ${config.secret}`;
  if (config.apiKey) headers['x-sdk-key'] = config.apiKey;

  const API_URL = process.env.LEMAI_API_URL || 'https://api.getlem.ai';
  const targetWebhookUrl = `${API_URL}/api/v1/webhooks/lem`;

  // Fire and Forget: Start the request without blocking the main flow
  axios.post(
    targetWebhookUrl,
    { branchName, ticketId, timestamp: startTime },
    { headers, timeout: 300000 }
  ).then(response => {
    // The backend uses chunked transfer encoding with heartbeat whitespace,
    // so axios may deliver response.data as a raw string instead of a parsed object.
    let parsed = response.data;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed.trim());
      } catch {
        log(`❌ Failed to parse backend response as JSON.`);
        process.exit(1);
        return;
      }
    }

    const { markdown, taskTitle } = parsed;

    if (markdown) {
      // Resolve output directory from config
      const outputDir = resolveOutputDir(gitRoot, config.outputDir || 'current');
      // Ensure the target directory exists (e.g. parent dir might not exist)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const filename = buildOutputFilename(taskTitle, ticketId);
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, markdown, 'utf-8');
      log(`✅ ${filename} generated successfully at ${outputPath}`);
    } else {
      log(`ℹ️ No markdown generated by backend.`);
    }
    process.exit(0);
  }).catch(err => {
    log(`❌ Error: ${err.message}`);
    if (err.response) {
      log(`Backend error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    }
    process.exit(1);
  });
}

module.exports = { checkout };
