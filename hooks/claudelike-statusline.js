#!/usr/bin/env node
/**
 * Claudelike Bar — Claude Code statusline script (standalone).
 *
 * Parses the statusline payload on stdin, extracts context window usage,
 * and merges it into the per-project status file so the sidebar tile can
 * display context %. Also prints a minimal status line for Claude Code
 * to show in the terminal.
 *
 * This script is COMPLETELY INDEPENDENT of the hook script
 * (dashboard-status.js). They share only the status file format — which is
 * a documented, stable interface. Either can run without the other.
 *
 * Zero npm dependencies — Node.js built-ins only.
 *
 * Install/uninstall is optional. The sidebar's tiles will still transition
 * between working/ready/waiting states without this; you just won't see a
 * context % badge on each tile.
 *
 * If you already have a Claude Code `statusLine.command` configured, the
 * extension will NOT overwrite it without an explicit confirmation, and
 * will back it up to `~/.claude/.claudelike-bar-statusline-backup.json` so
 * "Claudelike Bar: Restore Previous Statusline" can put it back.
 *
 * Debug logging: create `<STATUS_DIR>/.debug` to enable a trace log at
 * `<STATUS_DIR>/debug.log` — the extension toggles this file from config.
 * When debug is off, all errors are silent (statusline must never fail).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function sanitizeProject(name) {
  return (name || '')
    .replace(/[\r\n]/g, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/^\.+|\.+$/g, '');
}

// Write a line to <statusDir>/debug.log when the .debug flag file exists.
// Stays silent otherwise — the statusline must never throw or pollute stdout.
function debugLog(statusDir, line) {
  try {
    if (!fs.existsSync(path.join(statusDir, '.debug'))) return;
    fs.appendFileSync(
      path.join(statusDir, 'debug.log'),
      `[${new Date().toISOString()}] statusline: ${line}\n`,
    );
  } catch {
    // Debug log failure is silent — never fail the statusline on its own log.
  }
}

function main() {
  const statusDir = process.env.CLAUDELIKE_STATUS_DIR
    || path.join(os.tmpdir(), 'claude-dashboard');
  try { fs.mkdirSync(statusDir, { recursive: true }); } catch (err) {
    debugLog(statusDir, `mkdir failed: ${err && err.message}`);
    return;
  }

  let input = '';
  try {
    if (!process.stdin.isTTY) input = fs.readFileSync(0, 'utf8');
  } catch (err) {
    debugLog(statusDir, `stdin read failed: ${err && err.message}`);
  }

  let data = {};
  if (input) {
    try { data = JSON.parse(input); } catch (err) {
      debugLog(statusDir, `stdin JSON parse failed (bytes=${input.length}): ${err && err.message}`);
    }
  }

  const model = (data.model && typeof data.model.display_name === 'string') ? data.model.display_name : '';
  const cwd = (data.workspace && typeof data.workspace.current_dir === 'string')
    ? data.workspace.current_dir
    : (typeof data.cwd === 'string' ? data.cwd : process.cwd());
  // Only treat context_window.used_percentage as valid if it's actually a
  // number — we must not write context_percent=0 on empty/malformed input,
  // that would clobber a previously good value.
  const haveCtx = data.context_window && typeof data.context_window.used_percentage === 'number';
  const ctxPct = haveCtx ? Math.max(0, Math.min(100, Math.floor(data.context_window.used_percentage))) : null;

  const project = sanitizeProject(process.env.CLAUDELIKE_BAR_NAME || path.basename(cwd)) || 'unknown';

  // Merge context_percent into existing status file (if any), else start fresh.
  const statusFile = path.join(statusDir, `${project}.json`);
  let payload = { project, timestamp: Math.floor(Date.now() / 1000) };
  try {
    const existing = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    // Keep existing fields, overwrite only what we set.
    payload = Object.assign({}, existing, payload);
  } catch {}
  if (ctxPct !== null) {
    payload.context_percent = ctxPct;
  }

  // Atomic write via rename — same technique as the hook script.
  const tmpPath = `${statusFile}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload) + '\n');
    fs.renameSync(tmpPath, statusFile);
  } catch (err) {
    debugLog(statusDir, `atomic write to ${statusFile} failed: ${err && err.message}`);
    try { fs.unlinkSync(tmpPath); } catch {}
  }

  // Output a minimal status line for Claude Code to display in the terminal.
  // Nothing fancy — users who want rich status bars should bring their own.
  const parts = [];
  if (model) parts.push(model);
  if (project && project !== 'unknown') parts.push(project);
  if (ctxPct !== null) parts.push(`ctx ${ctxPct}%`);
  process.stdout.write(parts.join(' │ '));
}

try { main(); } catch (err) {
  // Statusline must never fail Claude's terminal, but when the user turns
  // debug on they get the reason. Fall back to tmpdir() in case the
  // failure happened before statusDir was resolved.
  try {
    const dir = process.env.CLAUDELIKE_STATUS_DIR
      || path.join(os.tmpdir(), 'claude-dashboard');
    debugLog(dir, `main() threw: ${err && err.stack ? err.stack : err}`);
  } catch {}
}
process.exit(0);
