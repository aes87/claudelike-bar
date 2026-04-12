export type SessionStatus = 'idle' | 'working' | 'ready' | 'waiting' | 'done' | 'ignored';

export interface TileData {
  id: number; // stable numeric identity — used as DOM key and in webview messages
  name: string;
  displayName: string; // nickname from config, or same as name
  status: SessionStatus;
  statusLabel: string; // resolved display text from config labels
  lastActivity: number; // unix timestamp
  event?: string;
  isActive: boolean;
  themeColor: string; // CSS variable name for the ANSI color
  icon: string | null; // codicon name (e.g. "calendar", "server")
  contextPercent?: number;
  contextWarn: number; // threshold for yellow
  contextCrit: number; // threshold for red
  ignoredText?: string;
}

export type WebviewMessage =
  | { type: 'switchTerminal'; id: number }
  | { type: 'cloneTerminal'; id: number }
  | { type: 'killTerminal'; id: number }
  | { type: 'markDone'; id: number }
  | { type: 'reorderTiles'; orderedIds: number[] }
  | { type: 'setColor'; id: number; color: string | null };

export interface StatusFileData {
  project: string;
  status: SessionStatus;
  timestamp: number;
  event: string;
  context_percent?: number;
}

export type ThemeGroup = 'cyan' | 'green' | 'blue' | 'magenta' | 'yellow' | 'white';

// Fallback color hints for common project-name patterns.
// The config file (.claudelike-bar.jsonc) overrides these — once a terminal
// appears in the config its color is read from there, not this map.
// Add entries here only for names likely to appear across many workspaces.
export const THEME_MAP: Record<string, ThemeGroup> = {};

// Use VS Code's terminal ANSI CSS variables so colors match terminal tab indicators exactly
export const THEME_CSS_VARS: Record<ThemeGroup, string> = {
  cyan: 'var(--vscode-terminal-ansiCyan)',
  green: 'var(--vscode-terminal-ansiGreen)',
  blue: 'var(--vscode-terminal-ansiBrightBlue)',
  magenta: 'var(--vscode-terminal-ansiMagenta)',
  yellow: 'var(--vscode-terminal-ansiYellow)',
  white: 'var(--vscode-terminal-ansiBrightWhite)',
};

export const COLOR_OVERRIDE_CSS: Record<string, string> = {
  ...THEME_CSS_VARS,
  red: 'var(--vscode-terminal-ansiRed)',
};

export function getDefaultColor(projectName: string): ThemeGroup {
  return THEME_MAP[projectName] ?? 'white';
}

export function getThemeColor(projectName: string, override?: string): string {
  if (override && COLOR_OVERRIDE_CSS[override]) {
    return COLOR_OVERRIDE_CSS[override];
  }
  return THEME_CSS_VARS[getDefaultColor(projectName)];
}

// Fallback icon hints for common project-name patterns.
// Same as THEME_MAP — the config file takes precedence once it exists.
export const ICON_MAP: Record<string, string> = {};
