# Claudelike Bar

VS Code sidebar extension that shows live status tiles for Claude Code terminal sessions.

## Setup

Run `./setup.sh` — it handles everything (hook script, settings.json merge, build, install). Idempotent and safe to re-run.

## Architecture

```
Claude Code hooks (4 events)
    → ~/.claude/hooks/dashboard-status.sh
    → writes JSON to /tmp/claude-dashboard/{project}.json
    → VS Code FileSystemWatcher picks it up
    → sidebar tiles update
```

### Source layout

```
src/
  extension.ts          — activation, wiring
  configManager.ts      — reads/writes .claudelike-bar.jsonc (JSONC format)
  terminalTracker.ts    — terminal lifecycle + status state machine
  statusWatcher.ts      — watches /tmp/claude-dashboard/*.json
  dashboardProvider.ts  — webview sidebar
  types.ts              — shared types, theme/icon maps
media/
  webview.js            — tile rendering (vanilla JS, DOM diffing)
  webview.css           — styles using VS Code CSS variables
  codicon.css/ttf       — icon font
  dashboard.svg         — activity bar icon
hooks/
  dashboard-status.sh   — hook script (copied to ~/.claude/hooks/ by setup)
  settings-snippet.json — hook config for manual merge
scripts/
  merge-hooks.js        — idempotent settings.json hook merger (ESM, no deps)
```

### Config file

`.claudelike-bar.jsonc` in the workspace root. JSONC (JSON with comments). Auto-created on first terminal open. Template-based write preserves section headers.

Key settings:
- `mode`: `"chill"` or `"passive-aggressive"` — personality mode
- `labels`: custom status text
- `contextThresholds`: warn/crit percentages for context window
- `ignoredTexts`: passive-aggressive mode messages
- `terminals`: per-project color, icon, nickname, autoStart

### Build

```bash
npm install
npm run build      # esbuild → dist/extension.js
npm run package    # build + vsce → .vsix
```

### Status state machine

```
idle → working (UserPromptSubmit/PreToolUse)
working → ready (Stop/Notification)
ready → waiting (60s timeout)
waiting/ready → ignored (user focused then switched away, passive-aggressive mode)
waiting/ready → done (user focused then switched away, chill mode)
* → working (UserPromptSubmit resets everything)
```

## Verify installation

```bash
# Hooks registered?
grep dashboard-status ~/.claude/settings.json

# Hook script in place?
ls -la ~/.claude/hooks/dashboard-status.sh

# Status files being written?
cat /tmp/claude-dashboard/*.json
```
