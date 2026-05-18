'use strict';
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { findGitRoot, getConfigPath } = require('./config');

const HOOK_SCRIPT = `#!/bin/sh
# Injected by lem-ai
# This hook captures all branch creation events (git branch, git checkout -b, git switch -c)
if [ "$1" = "committed" ]; then
    while read -r old_rev new_rev ref_name; do
        # Check if it's a brand new local branch (old_rev is all zeros)
        if [ "$old_rev" = "0000000000000000000000000000000000000000" ] && [ "\${ref_name#refs/heads/}" != "$ref_name" ] && [ "$new_rev" != "0000000000000000000000000000000000000000" ]; then
            BRANCH_NAME=\${ref_name#refs/heads/}
            # Run synchronously since we fixed the Node hang issue
            lem-ai checkout "$BRANCH_NAME"
        fi
    done
fi
`;

async function install() {
  const { loadConfig } = require('./config');
  const { setup } = require('./setup');
  const config = loadConfig();

  // If config is missing or the new apiKey field is missing, force setup
  if (!config || !config.apiKey) {
    console.log(chalk.yellow('⚠️   Configuration missing or outdated. Starting setup...'));
    await setup();
  }

  const repoRoot = findGitRoot(process.cwd());
  if (!repoRoot) {
    console.error(chalk.red('❌  Not inside a git repository.'));
    process.exit(1);
  }

  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'reference-transaction');

  // Clean up ALL legacy hooks
  const oldHooks = ['post-checkout', 'reference-transaction'];
  for (const h of oldHooks) {
    const p = path.join(hooksDir, h);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      if (content.includes('git-jira-hook') || content.includes('getlem') || content.includes('lem')) {
        if (h === 'reference-transaction' && content.includes('Injected by lem-ai')) {
          // This is current, skip
          continue;
        }
        fs.unlinkSync(p);
        console.log(chalk.gray(`ℹ️  Cleaned up legacy hook: ${h}`));
      }
    }
  }

  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

  if (fs.existsSync(hookPath)) {
    fs.copyFileSync(hookPath, hookPath + '.backup');
    console.log(chalk.yellow('⚠️   Existing hook backed up'));
  }

  fs.writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
  console.log(chalk.green(`\n✅  Ref-Transaction Hook installed/updated → ${hookPath}`));
  console.log(chalk.cyan('🎉  This will now trigger on ANY branch creation method:'));
  console.log(chalk.gray('    - git branch <name>'));
  console.log(chalk.gray('    - git checkout -b <name>'));
  console.log(chalk.gray('    - git switch -c <name>\n'));
}

function uninstall() {
  const repoRoot = findGitRoot(process.cwd());
  if (!repoRoot) {
    console.error(chalk.red('❌  Not inside a git repository.'));
    process.exit(1);
  }

  const hookPath = path.join(repoRoot, '.git', 'hooks', 'reference-transaction');

  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf-8');
    if (content.includes('lem-ai') || content.includes('getlem') || content.includes('lem') || content.includes('git-jira-hook')) {
      fs.unlinkSync(hookPath);
      console.log(chalk.green('\n✅  lem-ai Git Hook uninstalled successfully.\n'));
    } else {
      console.log(chalk.yellow('\n⚠️   Hook at this path was not created by lem-ai. Skipping.\n'));
    }
  } else {
    console.log(chalk.gray('\nℹ️   No lem-ai hook found to uninstall.\n'));
  }

  // Also remove the project-level config file if it exists
  const configPath = getConfigPath();
  if (configPath && fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    console.log(chalk.gray('ℹ️   Project configuration removed.'));
  }
}

module.exports = { install, uninstall };
