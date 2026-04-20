import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectLegacyHooks, removeLegacyHooks } from '../src/legacyHooks';

/**
 * Tests run against a real temp HOME so writeSettingsAtomic lands somewhere
 * deterministic. claudePaths resolves all locations off os.homedir() so
 * swapping HOME per-test is enough — no module mocks needed (project
 * convention: real fs, no Node builtin mocks).
 */

let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let tmpHome: string;

function settingsFilePath(): string {
  return path.join(tmpHome, '.claude', 'settings.json');
}

function writeSettings(obj: unknown): void {
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(settingsFilePath(), JSON.stringify(obj, null, 2));
}

function readSettings(): any {
  return JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8'));
}

beforeEach(() => {
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-hooks-'));
  // Node's os.homedir() reads USERPROFILE on Windows, HOME on *nix.
  // Set both so the redirect works on every CI target.
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('detectLegacyHooks', () => {
  it('returns empty result when settings.json is missing', () => {
    expect(detectLegacyHooks()).toEqual({ events: [], count: 0 });
  });

  it('returns empty result when hooks section is missing', () => {
    writeSettings({ other: 'value' });
    expect(detectLegacyHooks()).toEqual({ events: [], count: 0 });
  });

  it('finds a single notify.sh reference on Notification', () => {
    writeSettings({
      hooks: {
        Notification: [
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/notify.sh' }] },
        ],
      },
    });
    const { events, count } = detectLegacyHooks();
    expect(count).toBe(1);
    expect(events).toEqual(['Notification']);
  });

  it('finds notify-silent.sh references across multiple events', () => {
    writeSettings({
      hooks: {
        Stop: [
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/notify-silent.sh' }] },
        ],
        Notification: [
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/notify-silent.sh' }] },
        ],
      },
    });
    const { events, count } = detectLegacyHooks();
    expect(count).toBe(2);
    expect(events.sort()).toEqual(['Notification', 'Stop']);
  });

  it('ignores non-legacy hook entries (dashboard-status.js)', () => {
    writeSettings({
      hooks: {
        Stop: [
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/dashboard-status.js' }] },
        ],
      },
    });
    expect(detectLegacyHooks()).toEqual({ events: [], count: 0 });
  });

  it('returns empty for malformed settings.json (no crash)', () => {
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    fs.writeFileSync(settingsFilePath(), '{"hooks": [not-valid-json');
    expect(detectLegacyHooks()).toEqual({ events: [], count: 0 });
  });
});

describe('removeLegacyHooks', () => {
  it('is a no-op when no legacy entries exist', () => {
    writeSettings({
      hooks: {
        Stop: [
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/dashboard-status.js' }] },
        ],
      },
    });
    const { removed } = removeLegacyHooks();
    expect(removed).toBe(0);
    // Non-legacy hook still present.
    expect(readSettings().hooks.Stop[0].hooks[0].command).toContain('dashboard-status.js');
  });

  it('strips legacy hooks while preserving dashboard-status.js siblings', () => {
    writeSettings({
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: '/home/u/.claude/hooks/notify-silent.sh' },
              { type: 'command', command: '/home/u/.claude/hooks/dashboard-status.js' },
            ],
          },
        ],
      },
    });
    const { removed } = removeLegacyHooks();
    expect(removed).toBe(1);
    const s = readSettings();
    expect(s.hooks.Stop[0].hooks).toHaveLength(1);
    expect(s.hooks.Stop[0].hooks[0].command).toContain('dashboard-status.js');
  });

  it('removes entries entirely when all their hooks were legacy', () => {
    writeSettings({
      hooks: {
        Notification: [
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/notify.sh' }] },
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/dashboard-status.js' }] },
        ],
      },
    });
    const { removed } = removeLegacyHooks();
    expect(removed).toBe(1);
    const s = readSettings();
    // Legacy-only entry removed; dashboard entry retained.
    expect(s.hooks.Notification).toHaveLength(1);
    expect(s.hooks.Notification[0].hooks[0].command).toContain('dashboard-status.js');
  });

  it('does not modify the file when no legacy entries exist', () => {
    writeSettings({ hooks: {} });
    const beforeMtime = fs.statSync(settingsFilePath()).mtimeMs;
    const { removed } = removeLegacyHooks();
    expect(removed).toBe(0);
    // writeSettingsAtomic is only called when something was removed.
    const afterMtime = fs.statSync(settingsFilePath()).mtimeMs;
    expect(afterMtime).toBe(beforeMtime);
  });

  it('leaves other unrelated settings fields untouched', () => {
    writeSettings({
      permissions: { allow: ['Read', 'Write'] },
      hooks: {
        Stop: [
          { matcher: '', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/notify.sh' }] },
        ],
      },
      voiceEnabled: true,
    });
    removeLegacyHooks();
    const s = readSettings();
    expect(s.permissions.allow).toEqual(['Read', 'Write']);
    expect(s.voiceEnabled).toBe(true);
  });
});
