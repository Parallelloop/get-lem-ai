'use strict';
const readline = require('readline');
const chalk = require('chalk');
const { saveConfig } = require('./config');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function askSelection(rl, question, options) {
  return new Promise(resolve => {
    console.log(chalk.white(question));
    options.forEach((opt, i) => {
      console.log(chalk.gray(`  [${i + 1}] ${opt.label}`));
    });
    rl.question(chalk.white('Enter choice [1]: '), answer => {
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx].value);
      } else {
        // Default to first option
        resolve(options[0].value);
      }
    });
  });
}

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.cyan('\n🔧  get-lem-ai Setup\n'));

  const outputDir = await askSelection(rl, 'Where should the Implementation file be placed?', [
    { label: 'Inside the current repo directory (default)', value: 'current' },
    { label: 'One step backward (../)', value: 'parent' },
    { label: 'Root of the git repository', value: 'root' },
  ]);

  const apiKey = await ask(rl, chalk.white('SDK API Key (from Lem settings): '));

  rl.close();
  saveConfig({
    outputDir: outputDir.trim() || 'current',
    apiKey: apiKey.trim()
  });

  console.log(chalk.green('\n✅  Config saved to .lem-ai.json'));
  console.log(chalk.yellow('👉  Now cd into a git repo and run: get-lem-ai install\n'));
}

module.exports = { setup };
