'use strict';
const readline = require('readline');
const chalk = require('chalk');
const { saveConfig } = require('./config');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.cyan('\n🔧  lem-ai Setup\n'));

  const outputFile = await ask(rl, 'Output filename [Implementation.md]: ') || 'Implementation.md';
  const apiKey = await ask(rl, 'SDK API Key (from Lem settings): ');

  rl.close();
  saveConfig({
    outputFile: outputFile.trim() || 'Implementation.md',
    apiKey: apiKey.trim()
  });

  console.log(chalk.green('\n✅  Config saved to .lem-ai.json'));
  console.log(chalk.yellow('👉  Now cd into a git repo and run: lem-ai install\n'));
}

module.exports = { setup };
