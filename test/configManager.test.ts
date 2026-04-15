import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigManager } from '../src/configManager';

/**
 * ConfigManager options tests — verify the v0.9.2 cross-platform auto-start
 * contract. The extension passes `env` through createTerminal's API so the
 * hook gets CLAUDELIKE_BAR_NAME without any shell-syntax quoting, and
 * optionally passes `shellPath` / `shellArgs` from per-terminal config so
 * Windows users can pin git-bash (or any shell) for bash-syntax commands.
 */
describe('ConfigManager.getAutoStartTerminalOptions', () => {
  let tmpWorkspace: string;
  let cm: ConfigManager;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-opts-test-'));
  });

  afterEach(() => {
    if (cm) cm.dispose();
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  function writeConfig(config: object): void {
    fs.writeFileSync(
      path.join(tmpWorkspace, '.claudelike-bar.jsonc'),
      JSON.stringify(config),
    );
  }

  function makeCm(): ConfigManager {
    // The mock vscode workspaceFolders returns a fixed test path; override
    // by placing the config in a known temp dir and poking vscode's mock.
    (vscode.workspace as any).workspaceFolders = [
      { uri: (vscode.Uri as any).file(tmpWorkspace), name: 'test', index: 0 },
    ];
    cm = new ConfigManager();
    return cm;
  }

  it('always sets CLAUDELIKE_BAR_NAME env matching the terminal name', () => {
    writeConfig({ terminals: { 'my-terminal': { color: 'cyan', icon: null, nickname: null, autoStart: true } } });
    const opts = makeCm().getAutoStartTerminalOptions('my-terminal');
    expect(opts.env.CLAUDELIKE_BAR_NAME).toBe('my-terminal');
  });

  it('sets env even for terminal names not yet in the config', () => {
    writeConfig({ terminals: {} });
    const opts = makeCm().getAutoStartTerminalOptions('fresh-terminal');
    expect(opts.env.CLAUDELIKE_BAR_NAME).toBe('fresh-terminal');
  });

  it('preserves special characters in the env var (no shell quoting needed)', () => {
    writeConfig({ terminals: { "Matt's Project": { color: 'cyan', icon: null, nickname: null, autoStart: true } } });
    const opts = makeCm().getAutoStartTerminalOptions("Matt's Project");
    // createTerminal({env}) takes the raw string through the API; no escaping
    // required. This is the whole point of replacing sendText('export ...').
    expect(opts.env.CLAUDELIKE_BAR_NAME).toBe("Matt's Project");
  });

  it('omits shellPath/shellArgs when the terminal config has none', () => {
    writeConfig({ terminals: { 'plain': { color: 'cyan', icon: null, nickname: null, autoStart: true } } });
    const opts = makeCm().getAutoStartTerminalOptions('plain');
    expect(opts.shellPath).toBeUndefined();
    expect(opts.shellArgs).toBeUndefined();
  });

  it('returns shellPath when the terminal config sets one', () => {
    writeConfig({
      terminals: {
        'pinned-bash': {
          color: 'cyan',
          icon: null,
          nickname: null,
          autoStart: true,
          shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
        },
      },
    });
    const opts = makeCm().getAutoStartTerminalOptions('pinned-bash');
    expect(opts.shellPath).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(opts.shellArgs).toBeUndefined();
  });

  it('returns shellPath + shellArgs when the config sets both', () => {
    writeConfig({
      terminals: {
        'pwsh-clean': {
          color: 'cyan',
          icon: null,
          nickname: null,
          autoStart: true,
          shellPath: 'pwsh.exe',
          shellArgs: ['-NoProfile', '-Command'],
        },
      },
    });
    const opts = makeCm().getAutoStartTerminalOptions('pwsh-clean');
    expect(opts.shellPath).toBe('pwsh.exe');
    expect(opts.shellArgs).toEqual(['-NoProfile', '-Command']);
  });

  it('ignores shellArgs without shellPath (no partial config)', () => {
    writeConfig({
      terminals: {
        'bad-cfg': {
          color: 'cyan',
          icon: null,
          nickname: null,
          autoStart: true,
          shellArgs: ['--what'],
        },
      },
    });
    const opts = makeCm().getAutoStartTerminalOptions('bad-cfg');
    expect(opts.shellPath).toBeUndefined();
    expect(opts.shellArgs).toBeUndefined();
  });

  it('ignores empty-string shellPath (treats as unset)', () => {
    writeConfig({
      terminals: {
        'empty': {
          color: 'cyan',
          icon: null,
          nickname: null,
          autoStart: true,
          shellPath: '',
        },
      },
    });
    const opts = makeCm().getAutoStartTerminalOptions('empty');
    expect(opts.shellPath).toBeUndefined();
  });

  it('filters non-string shellArgs entries (defensive — JSONC is untyped)', () => {
    writeConfig({
      terminals: {
        'defensive': {
          color: 'cyan',
          icon: null,
          nickname: null,
          autoStart: true,
          shellPath: '/bin/bash',
          // JSONC can smuggle arbitrary values; we only accept strings.
          shellArgs: ['-l', 42, null, '-i'] as any,
        },
      },
    });
    const opts = makeCm().getAutoStartTerminalOptions('defensive');
    expect(opts.shellArgs).toEqual(['-l', '-i']);
  });

  it('drops shellArgs when every entry is non-string (remains undefined)', () => {
    writeConfig({
      terminals: {
        'all-garbage': {
          color: 'cyan',
          icon: null,
          nickname: null,
          autoStart: true,
          shellPath: '/bin/bash',
          shellArgs: [42, null, {}] as any,
        },
      },
    });
    const opts = makeCm().getAutoStartTerminalOptions('all-garbage');
    // shellPath retained, but empty shellArgs collapses to undefined so the
    // spread in extension.ts doesn't pass a meaningless empty array.
    expect(opts.shellPath).toBe('/bin/bash');
    expect(opts.shellArgs).toBeUndefined();
  });
});
