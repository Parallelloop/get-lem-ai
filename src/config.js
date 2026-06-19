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
  if (repoRoot) return path.join(repoRoot, '.lem-ai.json');
  // Fallback: save globally in home directory when not inside a git repo
  return path.join(require('os').homedir(), '.lem-ai.json');
}

function loadConfig() {
  // Try the git repo config first
  const repoRoot = findGitRoot(process.cwd());
  if (repoRoot) {
    const repoConfigPath = path.join(repoRoot, '.lem-ai.json');
    if (fs.existsSync(repoConfigPath)) {
      try { return JSON.parse(fs.readFileSync(repoConfigPath, 'utf-8')); }
      catch { return null; }
    }
  }
  // Fallback: try global home directory config
  const homeConfigPath = path.join(require('os').homedir(), '.lem-ai.json');
  if (fs.existsSync(homeConfigPath)) {
    try { return JSON.parse(fs.readFileSync(homeConfigPath, 'utf-8')); }
    catch { return null; }
  }
  return null;
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
  // configPath is always set now (falls back to home dir)
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
  // Only add to .gitignore when inside a git repo
  const repoRoot = findGitRoot(process.cwd());
  if (repoRoot) ensureGitignore();
}

const WEBHOOK_URL = 'https://api.getlem.ai/api/v1/webhooks/lem';

module.exports = { loadConfig, saveConfig, getConfigPath, findGitRoot, WEBHOOK_URL, ensureGitignore };
