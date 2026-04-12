import { describe, it, expect } from 'vitest';
import { shSingleQuote } from '../src/util';

describe('shSingleQuote', () => {
  it('wraps a simple string in single quotes', () => {
    expect(shSingleQuote('hello')).toBe("'hello'");
  });

  it('handles empty string', () => {
    expect(shSingleQuote('')).toBe("''");
  });

  it('escapes embedded single quotes', () => {
    expect(shSingleQuote("it's")).toBe("'it'\\''s'");
  });

  it('escapes multiple single quotes', () => {
    expect(shSingleQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it('does not escape double quotes', () => {
    expect(shSingleQuote('say "hello"')).toBe("'say \"hello\"'");
  });

  it('does not interpret dollar signs', () => {
    expect(shSingleQuote('$HOME')).toBe("'$HOME'");
  });

  it('does not interpret backticks', () => {
    expect(shSingleQuote('`whoami`')).toBe("'`whoami`'");
  });

  it('preserves backslashes literally (single quotes have no escape sequences)', () => {
    // Input: the string a\b (one backslash). Output: 'a\b' — no doubling needed.
    expect(shSingleQuote('a\\b')).toBe("'a\\b'");
  });

  it('handles newlines', () => {
    expect(shSingleQuote('line1\nline2')).toBe("'line1\nline2'");
  });

  it('handles a realistic terminal name', () => {
    expect(shSingleQuote('Vault Direct')).toBe("'Vault Direct'");
  });

  it('handles a name with special chars', () => {
    expect(shSingleQuote("Matt's Project")).toBe("'Matt'\\''s Project'");
  });
});
