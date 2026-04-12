import { describe, it, expect } from 'vitest';
import { getDefaultColor, getThemeColor, THEME_CSS_VARS } from '../src/types';

describe('getDefaultColor', () => {
  it('returns white for unknown project names', () => {
    expect(getDefaultColor('anything')).toBe('white');
  });

  it('returns white for empty string', () => {
    expect(getDefaultColor('')).toBe('white');
  });
});

describe('getThemeColor', () => {
  it('returns white CSS var for unknown project with no override', () => {
    expect(getThemeColor('unknown')).toBe(THEME_CSS_VARS.white);
  });

  it('uses color override when provided', () => {
    expect(getThemeColor('unknown', 'cyan')).toBe(THEME_CSS_VARS.cyan);
  });

  it('supports red override (not a ThemeGroup, but in COLOR_OVERRIDE_CSS)', () => {
    expect(getThemeColor('unknown', 'red')).toBe('var(--vscode-terminal-ansiRed)');
  });

  it('ignores invalid override and falls back to default', () => {
    expect(getThemeColor('unknown', 'neon-pink')).toBe(THEME_CSS_VARS.white);
  });
});
