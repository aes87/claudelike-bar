import * as vscode from 'vscode';
import { TileData, SessionStatus, getThemeColor } from './types';

const IGNORED_TEXTS = [
  'Being ignored :(',
  'Hello? Anyone?',
  "I'll just wait here then",
  'This is fine',
  'You have other terminals?',
  'Patiently judging you',
  'Still here btw',
  "I guess I'm not important",
  'Take your time, no rush',
  "It's not like I'm waiting or anything",
];

export class TerminalTracker implements vscode.Disposable {
  private terminals = new Map<number, TileData>();
  private disposables: vscode.Disposable[] = [];
  private onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onChange = this.onChangeEmitter.event;

  constructor() {
    // Track existing terminals
    for (const terminal of vscode.window.terminals) {
      this.addTerminal(terminal);
    }

    this.disposables.push(
      vscode.window.onDidOpenTerminal((t) => {
        this.addTerminal(t);
        this.onChangeEmitter.fire();
      }),
      vscode.window.onDidCloseTerminal((t) => {
        this.removeTerminal(t);
        this.onChangeEmitter.fire();
      }),
      vscode.window.onDidChangeActiveTerminal((active) => {
        this.handleActiveTerminalChange(active);
        this.onChangeEmitter.fire();
      }),
      this.onChangeEmitter,
    );
  }

  private addTerminal(terminal: vscode.Terminal): void {
    const name = terminal.name;
    if (name === 'bash' || name === 'zsh' || name === 'sh') return;

    const pid = this.getTerminalId(terminal);
    this.terminals.set(pid, {
      name,
      status: 'idle',
      lastActivity: Date.now(),
      isActive: vscode.window.activeTerminal === terminal,
      themeColor: getThemeColor(name),
    });
  }

  private removeTerminal(terminal: vscode.Terminal): void {
    const pid = this.getTerminalId(terminal);
    this.terminals.delete(pid);
  }

  private handleActiveTerminalChange(active: vscode.Terminal | undefined): void {
    const activeName = active?.name;

    for (const [, tile] of this.terminals) {
      tile.isActive = tile.name === activeName;

      if (tile.name === activeName) {
        // User focused this terminal — clear waiting/ignored
        if (tile.status === 'waiting' || tile.status === 'ignored') {
          tile.status = 'idle';
          tile.ignoredText = undefined;
        }
      } else {
        // User focused a DIFFERENT terminal — waiting becomes ignored
        if (tile.status === 'waiting') {
          tile.status = 'ignored';
          tile.ignoredText = IGNORED_TEXTS[Math.floor(Math.random() * IGNORED_TEXTS.length)];
        }
      }
    }
  }

  private getTerminalId(terminal: vscode.Terminal): number {
    const idx = vscode.window.terminals.indexOf(terminal);
    return idx >= 0 ? idx : Math.random() * 100000;
  }

  updateStatus(projectName: string, status: SessionStatus, event?: string, contextPercent?: number): void {
    for (const [, tile] of this.terminals) {
      if (tile.name === projectName) {
        // Don't let hook events override waiting/ignored — only the user focusing the terminal clears those
        if ((tile.status === 'waiting' || tile.status === 'ignored') && status === 'working') {
          // A new prompt was submitted — user is interacting, clear the sticky state
          if (event === 'UserPromptSubmit') {
            tile.status = status;
            tile.ignoredText = undefined;
          }
          // Otherwise ignore — keep waiting/ignored until user focuses
        } else {
          tile.status = status;
          tile.ignoredText = undefined;
        }
        tile.lastActivity = Date.now();
        tile.event = event;
        if (contextPercent !== undefined) {
          tile.contextPercent = contextPercent;
        }
      }
    }
    this.onChangeEmitter.fire();
  }

  updateContext(projectName: string, contextPercent: number): void {
    for (const [, tile] of this.terminals) {
      if (tile.name === projectName) {
        tile.contextPercent = contextPercent;
      }
    }
    this.onChangeEmitter.fire();
  }

  getTiles(): TileData[] {
    const tiles = Array.from(this.terminals.values());

    const statusOrder: Record<string, number> = { waiting: 0, ignored: 1, working: 2, done: 3, idle: 4 };
    tiles.sort((a, b) => {
      const orderDiff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      if (orderDiff !== 0) return orderDiff;
      return b.lastActivity - a.lastActivity;
    });

    return tiles;
  }

  getTerminalByName(name: string): vscode.Terminal | undefined {
    return vscode.window.terminals.find((t) => t.name === name);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.terminals.clear();
  }
}
