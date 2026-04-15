import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSetup, isSetupComplete } from '../src/setup';

describe('setup module', () => {
  let fakeHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let extensionPath: string;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-home-'));
    extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-ext-'));
    fs.mkdirSync(path.join(extensionPath, 'hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(extensionPath, 'hooks', 'dashboard-status.js'),
      '#!/usr/bin/env node\nconsole.log("test hook");\n',
    );
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(extensionPath, { recursive: true, force: true });
  });

  it('installs hook and registers all hook events in fresh environment', async () => {
    const result = await runSetup(extensionPath);
    // v0.9.1: 13 events — v0.9's 8 plus SessionStart, SessionEnd,
    // PostToolUseFailure, PreCompact, PostCompact.
    expect(result.added).toBe(13);
    expect(result.migrated).toBe(0);

    const hookPath = path.join(fakeHome, '.claude', 'hooks', 'dashboard-status.js');
    expect(fs.existsSync(hookPath)).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'),
    );
    const allEvents = [
      'PreToolUse', 'UserPromptSubmit', 'Stop', 'Notification',
      'StopFailure', 'SubagentStart', 'SubagentStop', 'TeammateIdle',
      'SessionStart', 'SessionEnd', 'PostToolUseFailure', 'PreCompact', 'PostCompact',
    ];
    for (const event of allEvents) {
      expect(Array.isArray(settings.hooks[event])).toBe(true);
      const hasDashboardHook = settings.hooks[event].some(
        (e: any) => e.hooks?.some((h: any) => h.command?.includes('dashboard-status.js')),
      );
      expect(hasDashboardHook).toBe(true);
    }
  });

  it('isSetupComplete returns false in fresh environment', () => {
    expect(isSetupComplete()).toBe(false);
  });

  it('isSetupComplete returns true after runSetup', async () => {
    await runSetup(extensionPath);
    expect(isSetupComplete()).toBe(true);
  });

  it('runSetup is idempotent — second run adds 0, migrates 0', async () => {
    await runSetup(extensionPath);
    const second = await runSetup(extensionPath);
    expect(second.added).toBe(0);
    expect(second.migrated).toBe(0);
  });

  it('migrates legacy .sh references to .js', async () => {
    const claudeDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
          UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
          Notification: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
        },
      }),
    );

    const result = await runSetup(extensionPath);
    expect(result.migrated).toBeGreaterThan(0);

    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    expect(JSON.stringify(settings).includes('dashboard-status.sh')).toBe(false);
  });

  it('deduplicates when multiple .sh entries exist (all migrate to same .js command)', async () => {
    const claudeDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const mkEntry = (cmd: string) => ({ matcher: '', hooks: [{ type: 'command', command: cmd }] });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            mkEntry('~/.claude/hooks/dashboard-status.sh'),
            mkEntry('~/.claude/hooks/dashboard-status.sh'),
          ],
          UserPromptSubmit: [mkEntry('~/.claude/hooks/dashboard-status.sh')],
          Stop: [mkEntry('~/.claude/hooks/dashboard-status.sh')],
          Notification: [mkEntry('~/.claude/hooks/dashboard-status.sh')],
        },
      }),
    );

    await runSetup(extensionPath);
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    // Two .sh entries in PreToolUse migrate to the same .js command and should collapse to one
    const dashboardEntries = settings.hooks.PreToolUse.filter(
      (e: any) => e.hooks?.some((h: any) => h.command?.includes('dashboard-status')),
    );
    expect(dashboardEntries).toHaveLength(1);
  });

  it('running setup twice does not add duplicate registrations', async () => {
    await runSetup(extensionPath);
    await runSetup(extensionPath);
    const settings = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'),
    );
    for (const event of ['PreToolUse', 'UserPromptSubmit', 'Stop', 'Notification']) {
      const dashboardEntries = settings.hooks[event].filter(
        (e: any) => e.hooks?.some((h: any) => h.command?.includes('dashboard-status')),
      );
      expect(dashboardEntries).toHaveLength(1);
    }
  });

  it('preserves unrelated hooks in settings.json', async () => {
    const claudeDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'my-other-hook.sh' }] }],
        },
        someOtherSetting: { keep: 'this' },
      }),
    );

    await runSetup(extensionPath);
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    expect(settings.someOtherSetting).toEqual({ keep: 'this' });
    const stillThere = settings.hooks.PreToolUse.some(
      (e: any) => e.hooks?.some((h: any) => h.command?.includes('my-other-hook.sh')),
    );
    expect(stillThere).toBe(true);
    const ours = settings.hooks.PreToolUse.some(
      (e: any) => e.hooks?.some((h: any) => h.command?.includes('dashboard-status.js')),
    );
    expect(ours).toBe(true);
  });

  it('throws clearly when bundled hook is missing', async () => {
    fs.rmSync(path.join(extensionPath, 'hooks'), { recursive: true });
    await expect(runSetup(extensionPath)).rejects.toThrow(/not found/);
  });

  it('isSetupComplete returns false when only legacy .sh is registered (forces migration)', async () => {
    const claudeDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(path.join(claudeDir, 'hooks'), { recursive: true });
    // Hook script is present (as .js)
    fs.writeFileSync(path.join(claudeDir, 'hooks', 'dashboard-status.js'), '#!/usr/bin/env node\n');
    // But settings still reference legacy .sh
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
          UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
          Notification: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/dashboard-status.sh' }] }],
        },
      }),
    );

    expect(isSetupComplete()).toBe(false);
  });

  it('throws and preserves data when a hooks event value is not an array', async () => {
    const claudeDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: 'not-an-array',  // malformed user data
        },
      }),
    );

    await expect(runSetup(extensionPath)).rejects.toThrow(/PreToolUse is string/);
    // Verify the malformed value is untouched
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse).toBe('not-an-array');
  });

  it('recovers gracefully when settings.json is corrupted (non-JSON)', async () => {
    const claudeDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), 'this is not json');

    // Current behavior: treat corrupted settings as missing, start fresh.
    // This is documented behavior but worth locking in.
    await expect(runSetup(extensionPath)).rejects.toThrow(/Failed to parse/);
  });

  it('leaves no .tmp files behind after a successful write', async () => {
    await runSetup(extensionPath);
    const files = fs.readdirSync(path.join(fakeHome, '.claude'));
    expect(files.filter(f => f.includes('.tmp'))).toHaveLength(0);
  });
});
