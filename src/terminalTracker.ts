import * as vscode from 'vscode';
import { TileData, SessionStatus, HookStatusSignal, ICON_MAP, getThemeColor } from './types';
import { ConfigManager } from './configManager';

export class TerminalTracker implements vscode.Disposable {
  private terminals = new Map<number, TileData>();
  private terminalRefs = new Map<number, vscode.Terminal>();
  private terminalIdMap = new WeakMap<vscode.Terminal, number>();
  private nextId = 0;
  private disposables: vscode.Disposable[] = [];
  private onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onChange = this.onChangeEmitter.event;
  private nameRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private nameRefreshIdleCycles = 0;
  private configManager: ConfigManager;
  private log: (msg: string | (() => string)) => void;

  // State machine timers: ready → waiting after 60s
  private readyTimers = new Map<number, NodeJS.Timeout>();

  // Focus tracking: which tile was focused while in "waiting" state
  private focusedWaitingTile: number | null = null;

  constructor(configManager: ConfigManager, log?: (msg: string | (() => string)) => void) {
    this.configManager = configManager;
    this.log = log ?? (() => {});
    // Track existing terminals
    for (const terminal of vscode.window.terminals) {
      this.addTerminal(terminal);
    }

    this.disposables.push(
      vscode.window.onDidOpenTerminal((t) => {
        this.addTerminal(t);
        this.startNameRefresh(); // restart polling on new terminal
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

    // Periodically refresh terminal names — catches late profile name assignment
    this.startNameRefresh();
  }

  private addTerminal(terminal: vscode.Terminal): void {
    const name = terminal.name;
    if (name === 'bash' || name === 'zsh' || name === 'sh') return;

    // Auto-populate config file entry
    this.configManager.ensureEntry(name);
    const cfg = this.configManager.getTerminal(name);
    const thresholds = this.configManager.getContextThresholds();

    const id = this.assignId(terminal);
    this.terminalRefs.set(id, terminal);
    this.terminals.set(id, {
      id,
      name,
      displayName: cfg?.nickname || name,
      status: 'idle',
      statusLabel: this.configManager.getLabel('idle'),
      lastActivity: Date.now(),
      isActive: vscode.window.activeTerminal === terminal,
      themeColor: getThemeColor(name, cfg?.color),
      icon: cfg?.icon ?? ICON_MAP[name] ?? null,
      contextWarn: thresholds.warn,
      contextCrit: thresholds.crit,
      pendingSubagents: 0,
      teammateIdle: false,
    });
  }

  private removeTerminal(terminal: vscode.Terminal): void {
    const id = this.terminalIdMap.get(terminal);
    if (id !== undefined) {
      this.terminals.delete(id);
      this.terminalRefs.delete(id);
      this.clearReadyTimer(id);
      if (this.focusedWaitingTile === id) {
        this.focusedWaitingTile = null;
      }
    }
  }

  private handleActiveTerminalChange(active: vscode.Terminal | undefined): void {
    const activeId = active ? this.terminalIdMap.get(active) : undefined;

    // Check if we're leaving a tile that was focused while waiting
    if (this.focusedWaitingTile !== null && this.focusedWaitingTile !== activeId) {
      const tile = this.terminals.get(this.focusedWaitingTile);
      if (tile && (tile.status === 'waiting' || tile.status === 'ready')) {
        // User looked and left without acting — mode-dependent transition.
        // Also clear v0.9 transient flags — the tile is being explicitly
        // parked, so stale subagent counts or teammate-idle flags shouldn't
        // resurface if an auto-retry or stray signal arrives.
        const mode = this.configManager.getMode();
        if (mode === 'passive-aggressive') {
          const texts = this.configManager.getIgnoredTexts();
          tile.status = 'ignored';
          tile.ignoredText = texts[Math.floor(Math.random() * texts.length)];
          tile.statusLabel = tile.ignoredText;
        } else {
          tile.status = 'done';
          tile.statusLabel = this.configManager.getLabel('done');
          tile.ignoredText = undefined;
        }
        tile.pendingSubagents = 0;
        tile.teammateIdle = false;
        tile.errorType = undefined;
        this.clearReadyTimer(tile.id);
      }
      this.focusedWaitingTile = null;
    }

    for (const [id, tile] of this.terminals) {
      tile.isActive = id === activeId;

      // If focusing a tile that's waiting or ready, start tracking it
      if (id === activeId && (tile.status === 'waiting' || tile.status === 'ready')) {
        this.focusedWaitingTile = id;
      }
    }
  }

  private assignId(terminal: vscode.Terminal): number {
    let id = this.terminalIdMap.get(terminal);
    if (id === undefined) {
      id = this.nextId++;
      this.terminalIdMap.set(terminal, id);
    }
    return id;
  }

  private startNameRefresh(): void {
    this.nameRefreshIdleCycles = 0;
    if (this.nameRefreshTimer) return; // already running
    this.nameRefreshTimer = setInterval(() => this.refreshNames(), 2000);
  }

  private stopNameRefresh(): void {
    if (this.nameRefreshTimer) {
      clearInterval(this.nameRefreshTimer);
      this.nameRefreshTimer = undefined;
    }
  }

  /**
   * Re-check terminal names — picks up profile names assigned after onDidOpenTerminal,
   * and adds terminals that were initially filtered as "zsh" but since got renamed.
   * Stops itself after 3 consecutive no-change cycles to avoid wasted work.
   */
  private refreshNames(): void {
    let changed = false;

    for (const terminal of vscode.window.terminals) {
      const name = terminal.name;
      const id = this.terminalIdMap.get(terminal);

      if (id !== undefined) {
        // Already tracked — update name if it changed
        const tile = this.terminals.get(id);
        if (tile && tile.name !== name) {
          if (name === 'bash' || name === 'zsh' || name === 'sh') {
            // Name regressed to shell — remove it
            this.terminals.delete(id);
            this.terminalRefs.delete(id);
          } else {
            this.configManager.ensureEntry(name);
            const cfg = this.configManager.getTerminal(name);
            tile.name = name;
            tile.displayName = cfg?.nickname || name;
            tile.themeColor = getThemeColor(name, cfg?.color);
            tile.icon = cfg?.icon ?? ICON_MAP[name] ?? null;
          }
          changed = true;
        }
      } else if (name !== 'bash' && name !== 'zsh' && name !== 'sh') {
        // Not tracked yet — was likely "zsh" at open time, now has a real name
        this.addTerminal(terminal);
        changed = true;
      }
    }

    if (changed) {
      this.nameRefreshIdleCycles = 0;
      this.onChangeEmitter.fire();
    } else {
      this.nameRefreshIdleCycles++;
      if (this.nameRefreshIdleCycles >= 3) {
        this.stopNameRefresh();
      }
    }
  }

  /** Re-apply config (colors, nicknames, icons, thresholds) to all tracked tiles. */
  refreshFromConfig(): void {
    const thresholds = this.configManager.getContextThresholds();
    for (const [, tile] of this.terminals) {
      const cfg = this.configManager.getTerminal(tile.name);
      tile.displayName = cfg?.nickname || tile.name;
      tile.themeColor = getThemeColor(tile.name, cfg?.color);
      tile.icon = cfg?.icon ?? ICON_MAP[tile.name] ?? null;
      tile.contextWarn = thresholds.warn;
      tile.contextCrit = thresholds.crit;
      // Refresh status label — recompose v0.9 rich labels from current flags.
      // Skip `ignored` (uses custom passive-aggressive text).
      if (tile.status === 'ignored') {
        // keep tile.statusLabel as-is (random ignored text)
      } else if (tile.status === 'error') {
        tile.statusLabel = this.errorLabel(tile.errorType);
      } else if (tile.status === 'working' && tile.teammateIdle) {
        tile.statusLabel = this.configManager.getLabel('teammate_idle');
      } else if (tile.status === 'working') {
        tile.statusLabel = this.labelWithSubagents('working', tile.pendingSubagents ?? 0);
      } else {
        tile.statusLabel = this.configManager.getLabel(tile.status);
      }
    }
    this.onChangeEmitter.fire();
  }

  /**
   * Score how strongly a tile matches an incoming project name. Higher is better.
   *   3 — exact match on terminal name
   *   2 — explicit `projectName` alias in config
   *   1 — normalized match (lowercase, stripped whitespace/hyphens/underscores)
   *   0 — no match
   * Tier 3 (normalized) catches common cases like "VS Code Enhancement" vs
   * "vscode-enhancement" without requiring config, but is skipped when the
   * tile has an explicit `projectName` alias — that's the user's signal that
   * they've handled disambiguation themselves.
   */
  private matchScore(tile: TileData, projectName: string): number {
    if (tile.name === projectName) return 3;
    const cfg = this.configManager.getTerminal(tile.name);
    if (cfg?.projectName && cfg.projectName === projectName) return 2;
    if (cfg?.projectName) return 0; // explicit alias set but didn't match — opt out of normalized
    if (this.normalizeForMatch(tile.name) === this.normalizeForMatch(projectName)) return 1;
    return 0;
  }

  /**
   * Find the single best-matching tile for a given project name, preferring
   * exact matches over alias matches over normalized matches. Returns undefined
   * if no tile matches at any tier.
   */
  private findMatchingTile(projectName: string): TileData | undefined {
    let best: TileData | undefined;
    let bestScore = 0;
    for (const [, tile] of this.terminals) {
      const score = this.matchScore(tile, projectName);
      if (score > bestScore) {
        best = tile;
        bestScore = score;
        if (score === 3) break; // exact match — can't do better
      }
    }
    return best;
  }

  private normalizeForMatch(name: string): string {
    return name.toLowerCase().replace(/[-_\s]+/g, '');
  }

  /** Compose a working-state label that includes the subagent count if any. */
  private labelWithSubagents(key: string, count: number): string {
    const base = this.configManager.getLabel(key);
    if (count > 0) {
      return `${base} (${count} agent${count === 1 ? '' : 's'})`;
    }
    return base;
  }

  /** Map a StopFailure error_type matcher to a human-readable error label. */
  private errorLabel(errorType: string | undefined): string {
    const base = this.configManager.getLabel('error');
    const readable: Record<string, string> = {
      rate_limit: 'rate limit',
      authentication_failed: 'auth failed',
      billing_error: 'billing error',
      invalid_request: 'invalid request',
      server_error: 'server error',
      max_output_tokens: 'output limit',
      unknown: 'unknown error',
    };
    if (errorType && readable[errorType]) {
      return `${base}: ${readable[errorType]}`;
    }
    return base;
  }

  /** Refine the ready label based on the Notification matcher type. */
  private readyLabelForNotification(notifType: string | undefined): string {
    const overrides: Record<string, string> = {
      permission_prompt: 'Needs permission',
      idle_prompt: 'Awaiting input',
      elicitation_dialog: 'MCP needs input',
    };
    if (notifType && overrides[notifType]) {
      return overrides[notifType];
    }
    return this.configManager.getLabel('ready');
  }

  updateStatus(
    projectName: string,
    status: SessionStatus | HookStatusSignal,
    event?: string,
    contextPercent?: number,
    extra?: { tool_name?: string; agent_type?: string; error_type?: string; notification_type?: string },
  ): void {
    const tile = this.findMatchingTile(projectName);
    if (tile) {
      const prev = tile.status;
      let changed = false;

      // UserPromptSubmit is the universal reset — always goes to working,
      // clears subagent counter and teammate-idle flag.
      if (event === 'UserPromptSubmit') {
        tile.status = 'working';
        tile.statusLabel = this.configManager.getLabel('working');
        tile.ignoredText = undefined;
        tile.pendingSubagents = 0;
        tile.teammateIdle = false;
        tile.errorType = undefined;
        this.clearReadyTimer(tile.id);
        if (this.focusedWaitingTile === tile.id) {
          this.focusedWaitingTile = null;
        }
        changed = true;
      } else if (status === 'subagent_start') {
        // v0.9 — Task-tool subagent spawned. Increment counter, stay working.
        tile.pendingSubagents = (tile.pendingSubagents ?? 0) + 1;
        if (tile.status !== 'done') {
          tile.status = 'working';
          tile.errorType = undefined; // real activity — clear any prior error
          tile.statusLabel = this.labelWithSubagents('working', tile.pendingSubagents);
          tile.ignoredText = undefined;
          this.clearReadyTimer(tile.id);
          changed = true;
        }
      } else if (status === 'subagent_stop') {
        // v0.9 — subagent finished. Decrement counter (floor 0).
        tile.pendingSubagents = Math.max(0, (tile.pendingSubagents ?? 0) - 1);
        // Refresh label if we're showing a subagent count
        if (tile.status === 'working') {
          const newLabel = this.labelWithSubagents('working', tile.pendingSubagents);
          if (tile.statusLabel !== newLabel) {
            tile.statusLabel = newLabel;
            changed = true;
          }
          // Event-ordering fallback: if parent's Stop was suppressed earlier
          // because a subagent was in-flight, the Stop signal is gone — it
          // won't re-fire. When the last subagent finishes and we're still
          // in working with no teammate idle, promote to ready so the tile
          // doesn't get stuck. This mirrors what a Stop event would have
          // done if fired now.
          if (tile.pendingSubagents === 0 && !tile.teammateIdle) {
            tile.status = 'ready';
            tile.statusLabel = this.configManager.getLabel('ready');
            tile.ignoredText = undefined;
            this.startReadyTimer(tile.id);
            changed = true;
          }
        }
      } else if (status === 'teammate_idle') {
        // v0.9 — Agent Teams teammate waiting for a peer. Not "ready" — the
        // user isn't expected to reply; another teammate will feed it work.
        tile.teammateIdle = true;
        if (tile.status !== 'done') {
          tile.status = 'working';
          tile.errorType = undefined; // real activity — clear any prior error
          tile.statusLabel = this.configManager.getLabel('teammate_idle');
          tile.ignoredText = undefined;
          this.clearReadyTimer(tile.id);
          changed = true;
        }
      } else if (status === 'error') {
        // v0.9 — StopFailure. Red, sticky except for UserPromptSubmit.
        if (tile.status !== 'done') {
          tile.status = 'error';
          tile.errorType = extra?.error_type;
          tile.statusLabel = this.errorLabel(extra?.error_type);
          tile.ignoredText = undefined;
          this.clearReadyTimer(tile.id);
          changed = true;
        }
      } else if (status === 'ready') {
        // Stop/Notification → ready, then 60s timer → waiting.
        // v0.9: if a subagent is still running or a teammate is idle, the
        // parent turn ended but work is genuinely in-flight — stay `working`.
        // `done` is a sticky end state (user explicitly parked via
        // Mark-as-done) — only UserPromptSubmit un-parks it.
        // `ignored` is NOT sticky — it's auto-assigned by passive-aggressive
        // mode, so real activity (Stop/Notification) should override it.
        const hasActiveWork = (tile.pendingSubagents ?? 0) > 0 || tile.teammateIdle;
        if (hasActiveWork) {
          // Suppress the ready transition — log for debuggability.
          this.log(() => `suppressed ready for ${tile.name}: pendingSubagents=${tile.pendingSubagents}, teammateIdle=${tile.teammateIdle}`);
        } else if (tile.status !== 'ready' && tile.status !== 'done' && tile.status !== 'error') {
          // Notification matcher may refine the ready label.
          tile.status = 'ready';
          tile.statusLabel = this.readyLabelForNotification(extra?.notification_type);
          tile.ignoredText = undefined;
          this.startReadyTimer(tile.id);
          changed = true;
        }
      } else if (status === 'working') {
        // PreToolUse → working. `done` is a sticky end state (user explicitly
        // parked via Mark-as-done) — only UserPromptSubmit un-parks it.
        // `ignored` is NOT sticky — real work overrides it.
        // `error` is cleared here too: real tool use is unambiguous evidence
        // that Claude recovered (e.g. auto-retry after rate limit).
        // Keeping error sticky on `ready` still filters out transient
        // Notification events during an outage.
        if (tile.status !== 'done') {
          tile.status = 'working';
          // Real tool use indicates the agent is back to work — clear
          // teammate-idle and any lingering error type.
          if (tile.teammateIdle) tile.teammateIdle = false;
          tile.errorType = undefined;
          tile.statusLabel = this.labelWithSubagents('working', tile.pendingSubagents ?? 0);
          tile.ignoredText = undefined;
          this.clearReadyTimer(tile.id);
          changed = true;
        }
      }

      if (changed) {
        tile.lastActivity = Date.now();
        tile.event = event;
        this.log(() => `transition ${tile.name}: ${prev} → ${tile.status} (event=${event ?? '-'})`);
      } else {
        this.log(() => `no-op ${tile.name}: stayed ${prev} (event=${event ?? '-'}, incoming=${status})`);
      }
      let contextChanged = false;
      if (contextPercent !== undefined && tile.contextPercent !== contextPercent) {
        tile.contextPercent = contextPercent;
        contextChanged = true;
      }
      // Only fire when something actually changed — avoids spurious webview
      // repaints on no-op signals (e.g. v0.9 raw hook signals like
      // subagent_start that state machine doesn't yet act on).
      if (changed || contextChanged) {
        this.onChangeEmitter.fire();
      }
      return;
    }
    // Unmatched: log and do not fire — mirrors the `updateContext` pattern.
    this.log(() => {
      const names = Array.from(this.terminals.values()).map((t) => t.name).join(', ');
      return `unmatched status for "${projectName}" (tracked: [${names}])`;
    });
  }

  private startReadyTimer(id: number): void {
    this.clearReadyTimer(id);
    const timer = setTimeout(() => {
      this.readyTimers.delete(id);
      const tile = this.terminals.get(id);
      if (tile && tile.status === 'ready') {
        tile.status = 'waiting';
        tile.statusLabel = this.configManager.getLabel('waiting');
        // If this tile is currently focused, start tracking it
        if (tile.isActive) {
          this.focusedWaitingTile = id;
        }
        this.onChangeEmitter.fire();
      }
    }, 60_000);
    this.readyTimers.set(id, timer);
  }

  private clearReadyTimer(id: number): void {
    const existing = this.readyTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.readyTimers.delete(id);
    }
  }

  /**
   * Manually mark a tile as "done" — silences passive-aggressive judgement
   * when the user knows they're not actively using it. A subsequent
   * UserPromptSubmit will reset it back to "working".
   */
  markDone(id: number): void {
    const tile = this.terminals.get(id);
    if (!tile) return;
    const prev = tile.status;
    tile.status = 'done';
    tile.statusLabel = this.configManager.getLabel('done');
    tile.ignoredText = undefined;
    // Mark-done is a full park — clear v0.9 transient state so a later
    // auto-retry or stray signal doesn't show stale "Working (2 agents)" /
    // "Waiting for teammate" / "Error: rate limit" text.
    tile.pendingSubagents = 0;
    tile.teammateIdle = false;
    tile.errorType = undefined;
    tile.lastActivity = Date.now();
    this.clearReadyTimer(id);
    if (this.focusedWaitingTile === id) {
      this.focusedWaitingTile = null;
    }
    this.log(`manual mark-done ${tile.name}: ${prev} → done`);
    this.onChangeEmitter.fire();
  }

  setColor(id: number, color: string | undefined): void {
    const tile = this.terminals.get(id);
    if (!tile) return;
    // Persist to config file — single source of truth
    this.configManager.setColor(tile.name, color as any);
    const cfg = this.configManager.getTerminal(tile.name);
    tile.themeColor = getThemeColor(tile.name, cfg?.color);
    this.onChangeEmitter.fire();
  }

  updateContext(projectName: string, contextPercent: number): void {
    const tile = this.findMatchingTile(projectName);
    if (tile) {
      tile.contextPercent = contextPercent;
      this.onChangeEmitter.fire();
    }
  }

  getTiles(): TileData[] {
    const tiles = Array.from(this.terminals.values());

    if (this.configManager.getSortMode() === 'manual') {
      tiles.sort((a, b) => {
        const ao = this.configManager.getTerminal(a.name)?.order;
        const bo = this.configManager.getTerminal(b.name)?.order;
        // Unordered tiles sink to the bottom, most-recent first.
        if (ao === undefined && bo === undefined) return b.lastActivity - a.lastActivity;
        if (ao === undefined) return 1;
        if (bo === undefined) return -1;
        return ao - bo;
      });
      return tiles;
    }

    // Auto mode: status-based with lastActivity tiebreak.
    // error floats to the top (above waiting) — errors demand attention more
    // than a tile that's just been waiting a while.
    const statusOrder: Record<string, number> = { error: 0, waiting: 1, ignored: 2, ready: 3, working: 4, done: 5, idle: 6 };
    tiles.sort((a, b) => {
      const orderDiff = (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5);
      if (orderDiff !== 0) return orderDiff;
      return b.lastActivity - a.lastActivity;
    });

    return tiles;
  }

  /**
   * Apply a new manual ordering by tile IDs. Persists to the config file so
   * the order survives window reloads and container rebuilds.
   */
  reorderTiles(orderedIds: number[]): void {
    const orderedNames: string[] = [];
    for (const id of orderedIds) {
      const tile = this.terminals.get(id);
      if (tile) orderedNames.push(tile.name);
    }
    if (orderedNames.length === 0) return;
    // Single atomic call — ConfigManager owns both the order write and the
    // sortMode flip, so policy lives in one place.
    this.configManager.applyDragOrder(orderedNames);
    this.log(`reorder: ${orderedNames.join(', ')}`);
    this.onChangeEmitter.fire();
  }

  getTerminalById(id: number): vscode.Terminal | undefined {
    return this.terminalRefs.get(id);
  }

  getTerminalByName(name: string): vscode.Terminal | undefined {
    for (const [id, tile] of this.terminals) {
      if (tile.name === name) {
        return this.terminalRefs.get(id);
      }
    }
    return undefined;
  }

  dispose(): void {
    this.stopNameRefresh();
    for (const timer of this.readyTimers.values()) {
      clearTimeout(timer);
    }
    this.readyTimers.clear();
    for (const d of this.disposables) d.dispose();
    this.terminals.clear();
    this.terminalRefs.clear();
  }
}
