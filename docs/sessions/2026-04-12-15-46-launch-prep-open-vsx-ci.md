---
date: 2026-04-12
project: vscode-enhancement
type: session-log
---

# 2026-04-12 — Launch Prep: Open VSX, CI, Generalization

## Quick Reference
**Keywords:** claudelike-bar, vscode-extension, open-vsx, github-actions, vitest, ci, state-machine, ignored-bug, postAttachCommand, devcontainer, release, testing, outreach
**Project:** vscode-enhancement (claude-terminal-dashboard)
**Outcome:** Published Claudelike Bar to Open VSX (v0.7.6), added 33-test suite with 3-OS CI, fixed ignored-state bug, generalized all user-specific content for public repo, wrote launch strategy.

## What Was Done
- Fixed Claudelike Bar not installing on devcontainer rebuild — moved VSIX install from `postStartCommand` to `postAttachCommand`
- Set `claudeCommand` to null globally, added per-terminal `command` with hardcoded `cd /path && claude --dangerously-skip-permissions` for each autoStart terminal
- Generalized all user-specific project names from source (types.ts THEME_MAP/ICON_MAP), demo page (index.html), and README
- Replaced generic demo names with playful alternatives: world-domination, yeet-to-prod, print-go-brrr, spore-drive, brain-dump, sourdough-ops
- Fixed ignored-state bug: `ignored` was treated as sticky like `done`, but it's auto-assigned by passive-aggressive mode — PreToolUse and Stop/Notification should both override it
- v0.7.4: Added package.json marketplace fields (repository, homepage, bugs, license), config write error toast with dedup guard, setup.sh error handling, .vscodeignore cleanup
- v0.7.5: Defensive label fallback (`||` instead of `??`), debug log path in troubleshooting docs
- v0.7.6: Published to Open VSX, added categories/keywords/gallery banner, README badges
- Added vitest test suite: 33 tests covering shSingleQuote (11), types (4), terminalTracker state machine (18)
- Extracted shSingleQuote from extension.ts to src/util.ts for testability
- Created GitHub Actions CI workflow: build+test+package on Ubuntu/macOS/Windows, setup.sh smoke test on Ubuntu/macOS — all 5 jobs green
- Wrote comprehensive launch strategy doc (docs/launch-strategy.md)
- Drafted Reddit r/ClaudeAI launch post

## Decisions & Trade-offs
| Decision | Rationale |
|----------|-----------|
| `postAttachCommand` over `postStartCommand` for VSIX install | VS Code server not fully ready during postStartCommand on rebuild — `code` CLI fails silently |
| Per-terminal hardcoded `cd` commands instead of env var trick | More generalizable for other users — `$CLAUDELIKE_BAR_NAME` was clever but fragile and non-obvious |
| Empty THEME_MAP and ICON_MAP | Config file is the real source of truth — hardcoded maps were all user-specific project names |
| `ignored` not sticky for PreToolUse or Stop/Notification | `ignored` is auto-assigned by passive-aggressive mode, not user-initiated like `done` (Mark-as-done). Real activity should always override it. |
| Open VSX over VS Code Marketplace | No Azure DevOps account needed — just GitHub login. Covers Codespaces, Gitpod, VSCodium. Defer marketplace until demand. |
| vitest with vscode mock over @vscode/test-electron | Unit tests run anywhere without downloading VS Code. Integration tests deferred to CI where network is available. |
| Skip extra Linux distros in CI | Extension is pure JS bundle — no native code. Bash is bash across distros. VS Code version matters more than OS. |

## Files Modified
- `/workspace/.devcontainer/devcontainer.json`: postStartCommand → postAttachCommand for VSIX install, version bumps
- `/workspace/.claudelike-bar.jsonc`: per-terminal command overrides with cd paths
- `src/types.ts`: emptied THEME_MAP and ICON_MAP
- `src/terminalTracker.ts`: fixed ignored→working and ignored→ready transitions
- `src/configManager.ts`: write error toast with dedup guard, label fallback
- `src/extension.ts`: extracted shSingleQuote to util.ts
- `src/util.ts`: new file — shSingleQuote extracted for testability
- `index.html`: generalized + playful demo names
- `README.md`: generic examples, cd+command pattern, debug log docs, Open VSX badge
- `hooks/dashboard-status.sh`: generalized comment example
- `package.json`: marketplace fields, version bumps (0.7.3→0.7.6), vitest dep, test script
- `.vscodeignore`: exclude hooks/, test/, .github/, vitest config, old vsix files
- `setup.sh`: npm preflight check, error handling, fixed pipe swallowing npm install failures
- `.github/workflows/ci.yml`: new — 3-OS matrix CI
- `vitest.config.ts`: new — vitest config with vscode alias
- `test/__mocks__/vscode.ts`: new — minimal vscode mock
- `test/util.test.ts`: new — 11 shSingleQuote tests
- `test/types.test.ts`: new — 4 color/theme tests
- `test/terminalTracker.test.ts`: new — 18 state machine tests
- `docs/launch-strategy.md`: new — testing, deployment, outreach plan

## Follow-ups
- [ ] Alpha test in GitHub Codespaces (clone → setup.sh → exercise the sidebar)
- [ ] Alpha test on Windows native (no devcontainer) — already in progress
- [ ] Create `TESTING.md` with manual test checklist for community testers
- [ ] Generate outreach content drafts in `docs/outreach/` (Reddit, X, HN)
- [ ] Post to r/ClaudeAI after alpha testing passes
- [ ] Build `/release` skill to automate test → publish → tag → GitHub Release
- [ ] Add `@vscode/test-electron` activation smoke test to CI
- [ ] Consider VS Code Marketplace if >50 installs on Open VSX
