#!/usr/bin/env node
// Idempotent hook merger for Claudelike Bar
// Registers dashboard-status.js hooks in ~/.claude/settings.json.
// Migrates any legacy .sh references to .js in place.

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const { homedir, platform } = require('os');

const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const HOOK_SCRIPT = join(CLAUDE_DIR, 'hooks', 'dashboard-status.js');

// On Windows, the hook is invoked through the shell Claude Code uses.
// Prefix with `node` so it works regardless of file association / shebang support.
const HOOK_COMMAND = platform() === 'win32' ? `node "${HOOK_SCRIPT}"` : HOOK_SCRIPT;

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

function isDashboardHook(commandStr) {
  if (typeof commandStr !== 'string') return false;
  return commandStr.includes('dashboard-status.js') || commandStr.includes('dashboard-status.sh');
}

function hookAlreadyRegistered(hookArray) {
  if (!Array.isArray(hookArray)) return false;
  return hookArray.some(entry =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some(h => isDashboardHook(h.command))
  );
}

/**
 * Rewrite any legacy `.sh` hook references to the new `.js` command, then
 * deduplicate any resulting identical hook commands so a single event doesn't
 * get registered to invoke the hook multiple times.
 * Returns the number of entries migrated.
 */
function migrateLegacyHooks(hookArray) {
  if (!Array.isArray(hookArray)) return 0;
  let migrated = 0;
  for (const entry of hookArray) {
    if (!Array.isArray(entry.hooks)) continue;
    for (const h of entry.hooks) {
      if (typeof h.command === 'string' && h.command.includes('dashboard-status.sh')) {
        h.command = HOOK_COMMAND;
        migrated++;
      }
    }
    // Dedup inside this entry: keep only the first dashboard hook
    const seen = new Set();
    entry.hooks = entry.hooks.filter(h => {
      if (!isDashboardHook(h.command)) return true;
      if (seen.has(h.command)) return false;
      seen.add(h.command);
      return true;
    });
  }
  // Dedup across entries: remove duplicate dashboard-hook-only entries
  const seenEntry = new Set();
  for (let i = hookArray.length - 1; i >= 0; i--) {
    const entry = hookArray[i];
    if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) continue;
    // Only consider entries that contain exactly one dashboard hook and nothing else
    if (entry.hooks.length === 1 && isDashboardHook(entry.hooks[0].command)) {
      const key = entry.hooks[0].command;
      if (seenEntry.has(key)) {
        hookArray.splice(i, 1);
        migrated++;
      } else {
        seenEntry.add(key);
      }
    }
  }
  return migrated;
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
  let migrated = 0;
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
    }
    migrated += migrateLegacyHooks(settings.hooks[event]);
    if (!hookAlreadyRegistered(settings.hooks[event])) {
      settings.hooks[event].push(makeHookEntry());
      added++;
    }
  }

  if (added === 0 && migrated === 0) {
    console.log('Hooks already configured — no changes needed.');
    return;
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  const msgs = [];
  if (added > 0) msgs.push(`added hooks for ${added} event(s)`);
  if (migrated > 0) msgs.push(`migrated ${migrated} legacy .sh reference(s)`);
  console.log(`Updated ${SETTINGS_PATH}: ${msgs.join(', ')}`);
}

merge();
