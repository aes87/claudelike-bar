import * as path from 'path';

/**
 * v0.16.7 (#9) — does `child` live under `parent`? Both are absolute
 * paths from VS Code (`workspaceFolders[].uri.fsPath` and config
 * `terminals[].path`). Uses path.relative to handle Windows
 * case-insensitivity and trailing-slash quirks; the relative path
 * starting with `..` or being absolute means `child` is outside.
 * Equal paths count as "under" (workspace root opened directly).
 *
 * Lifted to its own module so the test suite can pin the path-comparison
 * semantics without spinning up the full extension activate() flow.
 */
export function isPathUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}
