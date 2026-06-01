'use strict';
const fs   = require('fs');
const path = require('path');

function findGitRoot(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  const parent = path.dirname(dir);
  if (parent === dir) return null;
  return findGitRoot(parent);
}

function getConfigPath() {
  const repoRoot = findGitRoot(process.cwd());
  if (!repoRoot) return null;
  return path.join(repoRoot, '.lem-ai.json');
}

function loadConfig() {
  const configPath = getConfigPath();
  if (!configPath || !fs.existsSync(configPath)) return null;
  try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
  catch { return null; }
}

function ensureGitignore() {
  const repoRoot = findGitRoot(process.cwd());
  if (!repoRoot) return;
  const gitignorePath = path.join(repoRoot, '.gitignore');
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  }
  const lines = content.split(/\r?\n/);
  const hasConfig = lines.some(line => line.trim() === '.lem-ai.json');
  if (!hasConfig) {
    const suffix = content.endsWith('\n') || content === '' ? '' : '\n';
    fs.appendFileSync(gitignorePath, `${suffix}.lem-ai.json\n`, 'utf-8');
  }
}

function saveConfig(data) {
  const configPath = getConfigPath();
  if (!configPath) {
    throw new Error('Not inside a git repository. Cannot save project-level config.');
  }
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
  ensureGitignore();
}

const WEBHOOK_URL = 'https://api.getlem.ai/api/v1/webhooks/lem';

module.exports = { loadConfig, saveConfig, getConfigPath, findGitRoot, WEBHOOK_URL, ensureGitignore };
