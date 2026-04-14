import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { getStatusDir } from '../src/statusDir';

describe('getStatusDir', () => {
  const originalEnv = process.env.CLAUDELIKE_STATUS_DIR;

  beforeEach(() => {
    delete process.env.CLAUDELIKE_STATUS_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAUDELIKE_STATUS_DIR;
    } else {
      process.env.CLAUDELIKE_STATUS_DIR = originalEnv;
    }
  });

  it('returns os.tmpdir()/claude-dashboard by default', () => {
    expect(getStatusDir()).toBe(path.join(os.tmpdir(), 'claude-dashboard'));
  });

  it('honors CLAUDELIKE_STATUS_DIR env override', () => {
    process.env.CLAUDELIKE_STATUS_DIR = '/custom/path';
    expect(getStatusDir()).toBe('/custom/path');
  });

  it('falls back to default when env var is empty string', () => {
    process.env.CLAUDELIKE_STATUS_DIR = '';
    expect(getStatusDir()).toBe(path.join(os.tmpdir(), 'claude-dashboard'));
  });

  it('returns a cross-platform path (no hardcoded /tmp/)', () => {
    // On Linux os.tmpdir() is usually /tmp, on macOS it's /var/folders/...,
    // on Windows it's C:\Users\...\AppData\Local\Temp. The key guarantee is
    // that it reflects the current OS's temp dir, not a hardcoded /tmp.
    const result = getStatusDir();
    expect(result).toContain('claude-dashboard');
    expect(result).toContain(os.tmpdir());
  });
});
