import * as os from 'os';
import * as path from 'path';

/**
 * Resolve the status directory path. This must agree between the hook script
 * (which writes status files) and the extension (which watches them).
 *
 * Both sides run in Node.js on the same OS, so `os.tmpdir()` returns the same
 * value for both. An optional `CLAUDELIKE_STATUS_DIR` env var overrides it for
 * custom setups (e.g., sandboxed environments with restricted tmp access).
 */
export function getStatusDir(): string {
  return process.env.CLAUDELIKE_STATUS_DIR
    || path.join(os.tmpdir(), 'claude-dashboard');
}
