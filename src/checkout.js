'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const { spawn } = require('child_process');
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
  // PHASE 1: Main Process — Spawn Background Worker & Exit
  // ────────────────────────────────────────────────────────────
  if (!process.env.LEMAI_BG) {
    console.log(chalk.cyan(`\n[get-lem-ai] 🚀 Branch detected: ${chalk.bold(branchName)}`));
    console.log(chalk.gray(`[get-lem-ai] ⚡ Generating implementation file in background...`));
    console.log(chalk.gray(`[get-lem-ai] 🏁 Git checkout will proceed instantly.\n`));

    // Spawn this same CLI command but with LEMAI_BG=true
    const child = spawn(process.argv[0], [process.argv[1], 'checkout', branchName], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, LEMAI_BG: 'true' },
      cwd: process.cwd()
    });

    child.unref();
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

  // Fire and Forget: Start the request without blocking the main flow
  axios.post(
    WEBHOOK_URL,
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
