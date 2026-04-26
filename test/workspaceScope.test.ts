import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { isPathUnder } from '../src/workspaceScope';

describe('isPathUnder (#9)', () => {
  it('matches identical paths (workspace root opened directly)', () => {
    const p = path.join(path.sep, 'home', 'matt', 'projects', 'foo');
    expect(isPathUnder(p, p)).toBe(true);
  });

  it('matches direct child', () => {
    const parent = path.join(path.sep, 'home', 'matt', 'projects');
    const child = path.join(path.sep, 'home', 'matt', 'projects', 'foo');
    expect(isPathUnder(child, parent)).toBe(true);
  });

  it('matches deep descendant', () => {
    const parent = path.join(path.sep, 'workspace', 'projects');
    const child = path.join(path.sep, 'workspace', 'projects', 'a', 'b', 'c');
    expect(isPathUnder(child, parent)).toBe(true);
  });

  it('rejects sibling directory', () => {
    const parent = path.join(path.sep, 'workspace', 'projects', 'foo');
    const sibling = path.join(path.sep, 'workspace', 'projects', 'bar');
    expect(isPathUnder(sibling, parent)).toBe(false);
  });

  it('rejects ancestor', () => {
    const parent = path.join(path.sep, 'workspace', 'projects', 'foo');
    const ancestor = path.join(path.sep, 'workspace');
    expect(isPathUnder(ancestor, parent)).toBe(false);
  });

  it('rejects unrelated absolute path', () => {
    const parent = path.join(path.sep, 'home', 'matt');
    const elsewhere = path.join(path.sep, 'tmp', 'scratch');
    expect(isPathUnder(elsewhere, parent)).toBe(false);
  });

  it('handles trailing slashes on parent', () => {
    const parent = path.join(path.sep, 'workspace', 'projects') + path.sep;
    const child = path.join(path.sep, 'workspace', 'projects', 'foo');
    expect(isPathUnder(child, parent)).toBe(true);
  });
});
