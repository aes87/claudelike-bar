#!/usr/bin/env node
// Idempotent hook merger for Claudelike Bar
// Adds dashboard-status.sh hooks to ~/.claude/settings.json without clobbering existing hooks.

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const HOOK_COMMAND = join(homedir(), '.claude', 'hooks', 'dashboard-status.sh');

const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'Stop', 'Notification'];

function loadSettings() {
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Failed to parse ${SETTINGS_PATH}: ${err.message}`);
  }
}

function hookAlreadyRegistered(hookArray) {
  if (!Array.isArray(hookArray)) return false;
  return hookArray.some(entry =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some(h => h.command && h.command.includes('dashboard-status.sh'))
  );
}

function makeHookEntry() {
  return {
    matcher: '',
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  };
}

function merge() {
  mkdirSync(CLAUDE_DIR, { recursive: true });

  const settings = loadSettings();
  if (!settings.hooks) settings.hooks = {};

  let added = 0;
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
    }
    if (!hookAlreadyRegistered(settings.hooks[event])) {
      settings.hooks[event].push(makeHookEntry());
      added++;
    }
  }

  if (added === 0) {
    console.log('Hooks already configured — no changes needed.');
    return;
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  console.log(`Added dashboard hooks for ${added} event(s) to ${SETTINGS_PATH}`);
}

merge();
