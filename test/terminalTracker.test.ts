import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { __resetMock } from './__mocks__/vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ConfigManager reads from disk on construction — write a minimal config first.
// Use os.tmpdir() for cross-platform compatibility (not hardcoded /tmp).
const TEST_ROOT = path.join(os.tmpdir(), 'test-workspace');
const CONFIG_PATH = path.join(TEST_ROOT, '.claudelike-bar.jsonc');

function writeConfig(config: Record<string, any> = { terminals: {} }) {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
}

function cleanConfig() {
  try { fs.unlinkSync(CONFIG_PATH); } catch {}
  try { fs.unlinkSync(path.join(TEST_ROOT, '.claudelike-bar.json')); } catch {}
}

// Import after mock is in place (vitest alias handles this)
import { ConfigManager } from '../src/configManager';
import { TerminalTracker } from '../src/terminalTracker';

function addMockTerminal(name: string) {
  const t = { name, sendText: vi.fn(), dispose: vi.fn() };
  (vscode.window.terminals as any[]).push(t);
  return t;
}

describe('TerminalTracker state machine', () => {
  let tracker: TerminalTracker;
  let config: ConfigManager;

  beforeEach(() => {
    __resetMock();
    writeConfig({ terminals: {} });
    // Add a terminal before constructing tracker (it scans window.terminals)
    addMockTerminal('my-project');
    config = new ConfigManager();
    tracker = new TerminalTracker(config);
  });

  afterEach(() => {
    tracker.dispose();
    config.dispose();
    cleanConfig();
  });

  function getTile() {
    const tiles = tracker.getTiles();
    return tiles.find(t => t.name === 'my-project');
  }

  it('starts in idle state', () => {
    expect(getTile()?.status).toBe('idle');
  });

  // --- UserPromptSubmit: universal reset ---

  it('UserPromptSubmit transitions idle → working', () => {
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    expect(getTile()?.status).toBe('working');
  });

  it('UserPromptSubmit transitions done → working', () => {
    tracker.markDone(getTile()!.id);
    expect(getTile()?.status).toBe('done');
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    expect(getTile()?.status).toBe('working');
  });

  it('UserPromptSubmit transitions ignored → working', () => {
    // Force into ignored state
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    tracker.updateStatus('my-project', 'ready', 'Stop');
    // Manually set to ignored for testing (normally done via focus tracking)
    const tile = getTile()!;
    (tile as any).status = 'ignored';
    (tile as any).ignoredText = 'Patiently judging you';
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    expect(getTile()?.status).toBe('working');
    expect(getTile()?.ignoredText).toBeUndefined();
  });

  // --- PreToolUse: working transition ---

  it('PreToolUse transitions idle → working', () => {
    tracker.updateStatus('my-project', 'working', 'PreToolUse');
    expect(getTile()?.status).toBe('working');
  });

  it('PreToolUse transitions ignored → working (not sticky)', () => {
    const tile = getTile()!;
    (tile as any).status = 'ignored';
    tracker.updateStatus('my-project', 'working', 'PreToolUse');
    expect(getTile()?.status).toBe('working');
  });

  it('PreToolUse does NOT transition done → working (done is sticky)', () => {
    tracker.markDone(getTile()!.id);
    tracker.updateStatus('my-project', 'working', 'PreToolUse');
    expect(getTile()?.status).toBe('done');
  });

  // --- Stop/Notification: ready transition ---

  it('Stop transitions working → ready', () => {
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    tracker.updateStatus('my-project', 'ready', 'Stop');
    expect(getTile()?.status).toBe('ready');
  });

  it('Notification transitions working → ready', () => {
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    tracker.updateStatus('my-project', 'ready', 'Notification');
    expect(getTile()?.status).toBe('ready');
  });

  it('Stop transitions ignored → ready (not sticky)', () => {
    const tile = getTile()!;
    (tile as any).status = 'ignored';
    tracker.updateStatus('my-project', 'ready', 'Stop');
    expect(getTile()?.status).toBe('ready');
  });

  it('Stop does NOT transition done → ready (done is sticky)', () => {
    tracker.markDone(getTile()!.id);
    tracker.updateStatus('my-project', 'ready', 'Stop');
    expect(getTile()?.status).toBe('done');
  });

  it('Stop on already-ready tile is a no-op', () => {
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    tracker.updateStatus('my-project', 'ready', 'Stop');
    const activity1 = getTile()!.lastActivity;
    tracker.updateStatus('my-project', 'ready', 'Stop');
    // lastActivity should not change on no-op
    expect(getTile()?.status).toBe('ready');
  });

  // --- markDone ---

  it('markDone sets status to done', () => {
    tracker.updateStatus('my-project', 'working', 'UserPromptSubmit');
    tracker.markDone(getTile()!.id);
    expect(getTile()?.status).toBe('done');
  });

  // --- context updates ---

  it('updateStatus carries context percent', () => {
    tracker.updateStatus('my-project', 'working', 'PreToolUse', 42);
    expect(getTile()?.contextPercent).toBe(42);
  });

  it('updateContext sets context percent independently', () => {
    tracker.updateContext('my-project', 75);
    expect(getTile()?.contextPercent).toBe(75);
  });

  // --- unmatched project ---

  it('ignores status updates for unknown projects', () => {
    tracker.updateStatus('nonexistent', 'working', 'PreToolUse');
    // Should not throw, and existing tile should be unchanged
    expect(getTile()?.status).toBe('idle');
  });
});

describe('TerminalTracker name matching (3-tier)', () => {
  let tracker: TerminalTracker;
  let config: ConfigManager;

  afterEach(() => {
    tracker?.dispose();
    config?.dispose();
    cleanConfig();
  });

  it('matches via exact terminal name (Tier 1)', () => {
    __resetMock();
    writeConfig({ terminals: {} });
    addMockTerminal('backend');
    config = new ConfigManager();
    tracker = new TerminalTracker(config);

    tracker.updateStatus('backend', 'working', 'PreToolUse');
    const tile = tracker.getTiles().find(t => t.name === 'backend');
    expect(tile?.status).toBe('working');
  });

  it('matches via explicit projectName alias (Tier 2)', () => {
    __resetMock();
    writeConfig({
      terminals: {
        'VS Code Enhancement': {
          color: 'yellow',
          icon: null,
          nickname: null,
          autoStart: false,
          projectName: 'vscode-enhancement',
        },
      },
    });
    addMockTerminal('VS Code Enhancement');
    config = new ConfigManager();
    tracker = new TerminalTracker(config);

    tracker.updateStatus('vscode-enhancement', 'working', 'PreToolUse');
    const tile = tracker.getTiles().find(t => t.name === 'VS Code Enhancement');
    expect(tile?.status).toBe('working');
  });

  it('matches via normalized fallback (Tier 3)', () => {
    __resetMock();
    writeConfig({ terminals: {} });
    addMockTerminal('VS Code Enhancement');
    config = new ConfigManager();
    tracker = new TerminalTracker(config);

    tracker.updateStatus('vscode-enhancement', 'working', 'PreToolUse');
    const tile = tracker.getTiles().find(t => t.name === 'VS Code Enhancement');
    expect(tile?.status).toBe('working');
  });

  it('prefers exact match over normalized match when both possible', () => {
    __resetMock();
    writeConfig({ terminals: {} });
    // Two terminals: one exact match, one that would normalize-match
    addMockTerminal('myapi');
    addMockTerminal('my-api');
    config = new ConfigManager();
    tracker = new TerminalTracker(config);

    // Incoming project "my-api" — should match the tile literally named "my-api"
    // (Tier 1, score 3) not "myapi" (Tier 3, score 1)
    tracker.updateStatus('my-api', 'working', 'PreToolUse');
    const exactTile = tracker.getTiles().find(t => t.name === 'my-api');
    const normalizedTile = tracker.getTiles().find(t => t.name === 'myapi');
    expect(exactTile?.status).toBe('working');
    expect(normalizedTile?.status).toBe('idle');
  });

  it('skips normalized match when projectName is explicitly set but does not match', () => {
    __resetMock();
    writeConfig({
      terminals: {
        'my-project': {
          color: 'cyan',
          icon: null,
          nickname: null,
          autoStart: false,
          projectName: 'explicitly-different',
        },
      },
    });
    addMockTerminal('my-project');
    config = new ConfigManager();
    tracker = new TerminalTracker(config);

    // Status for "myproject" would normally Tier-3 match "my-project",
    // but projectName is set to something else — user has opted out of fuzzy matching
    tracker.updateStatus('myproject', 'working', 'PreToolUse');
    const tile = tracker.getTiles().find(t => t.name === 'my-project');
    expect(tile?.status).toBe('idle');
  });

  it('updateContext uses the same matching logic', () => {
    __resetMock();
    writeConfig({ terminals: {} });
    addMockTerminal('VS Code Enhancement');
    config = new ConfigManager();
    tracker = new TerminalTracker(config);

    tracker.updateContext('vscode-enhancement', 55);
    const tile = tracker.getTiles().find(t => t.name === 'VS Code Enhancement');
    expect(tile?.contextPercent).toBe(55);
  });
});
