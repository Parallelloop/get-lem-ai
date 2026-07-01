'use strict';
const fs = require('fs');
const chalk = require('chalk');
const { loadConfig } = require('./config');

async function commitMsg(msgFilePath) {
  const config = loadConfig();

  // Only process if user has configured the API key
  if (!config || !config.apiKey) {
    process.exit(0);
  }

  if (!fs.existsSync(msgFilePath)) {
    process.exit(0);
  }

  const content = fs.readFileSync(msgFilePath, 'utf-8');
  
  // Clean up the message by removing comments and trimming whitespace
  const cleanMsg = content.split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
    .trim();

  // Let git handle completely empty commits
  if (cleanMsg.length === 0) {
    process.exit(0);
  }

  if (cleanMsg.length < 75) {
    console.log(chalk.red('\n❌ Commit message is too short!'));
    console.log(chalk.yellow(`📝 Current length: ${cleanMsg.length} characters.`));
    console.log(chalk.red('Please update the commit message to be of 75 characters.\n'));
    process.exit(1);
  }

  // Passed
  process.exit(0);
}

module.exports = { commitMsg };
