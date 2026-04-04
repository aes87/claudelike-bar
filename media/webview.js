// @ts-check
/// <reference lib="dom" />

const vscode = acquireVsCodeApi();
const container = document.getElementById('tiles-container');

const STATUS_LABELS = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting for input',
  done: 'Done',
  ignored: '', // uses custom ignoredText
};

let currentTiles = [];
let selectedIndex = -1;

// Handle messages from extension
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'update') {
    diffUpdate(message.tiles);
    currentTiles = message.tiles;
  }
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  const tiles = container.querySelectorAll('.tile');
  if (!tiles.length) return;

  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault();
    selectedIndex = Math.min(selectedIndex + 1, tiles.length - 1);
    tiles[selectedIndex].focus();
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault();
    selectedIndex = Math.max(selectedIndex - 1, 0);
    tiles[selectedIndex].focus();
  } else if (e.key === 'Enter' && selectedIndex >= 0) {
    e.preventDefault();
    tiles[selectedIndex].click();
  }
});

/**
 * DOM-diffing update: only touch elements that actually changed.
 * Prevents flicker, preserves click targets, skips unnecessary animation replays.
 */
function diffUpdate(tiles) {
  if (!tiles || tiles.length === 0) {
    if (container.querySelector('.empty-state')) return; // already showing empty
    container.innerHTML = '<div class="empty-state">No terminals open</div>';
    selectedIndex = -1;
    return;
  }

  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const existingEls = container.querySelectorAll('.tile');
  const existingByName = new Map();
  existingEls.forEach((el) => existingByName.set(el.dataset.name, el));

  const newNames = new Set(tiles.map((t) => t.name));

  // Remove tiles that no longer exist
  for (const [name, el] of existingByName) {
    if (!newNames.has(name)) {
      el.remove();
      existingByName.delete(name);
    }
  }

  // Update or create tiles in order
  let previousEl = null;
  tiles.forEach((tile, index) => {
    let el = existingByName.get(tile.name);

    if (el) {
      // Update existing tile in-place
      patchTile(el, tile);
    } else {
      // Create new tile
      el = createTileEl(tile, index);
      container.appendChild(el);
      // Animate entry
      requestAnimationFrame(() => {
        el.classList.remove('entering');
        el.classList.add('visible');
      });
    }

    // Ensure correct order
    if (previousEl) {
      if (previousEl.nextElementSibling !== el) {
        previousEl.after(el);
      }
    } else if (container.firstElementChild !== el) {
      container.prepend(el);
    }
    previousEl = el;
  });
}

/**
 * Patch an existing tile DOM element with new data — no rebuild.
 */
function patchTile(el, tile) {
  // Active state
  el.classList.toggle('active', tile.isActive);

  // Theme color
  el.style.setProperty('--tile-color', tile.themeColor);

  // Status dot
  const dot = el.querySelector('.dot');
  if (dot) {
    dot.className = `dot ${tile.status === 'ignored' ? 'ignored' : tile.status}`;
  }

  // Time
  const timeEl = el.querySelector('.tile-time');
  const timeStr = tile.status !== 'idle' ? formatRelativeTime(tile.lastActivity) : '';
  if (timeEl) {
    if (timeStr) {
      timeEl.textContent = timeStr;
    } else {
      timeEl.textContent = '';
    }
  }

  // Context %
  const ctxEl = el.querySelector('.tile-ctx');
  if (tile.contextPercent !== undefined && tile.contextPercent > 0) {
    const ctxClass = tile.contextPercent >= 80 ? 'ctx-crit' : tile.contextPercent >= 60 ? 'ctx-warn' : '';
    if (ctxEl) {
      ctxEl.textContent = `ctx ${tile.contextPercent}%`;
      ctxEl.className = `tile-ctx ${ctxClass}`;
    } else {
      // Insert ctx badge after time
      const header = el.querySelector('.tile-header');
      if (header) {
        const badge = document.createElement('span');
        badge.className = `tile-ctx ${ctxClass}`;
        badge.textContent = `ctx ${tile.contextPercent}%`;
        header.appendChild(badge);
      }
    }
  } else if (ctxEl) {
    ctxEl.remove();
  }

  // Status text
  const statusEl = el.querySelector('.tile-status');
  if (statusEl) {
    const label = tile.status === 'ignored'
      ? (tile.ignoredText || 'Being ignored :(')
      : (STATUS_LABELS[tile.status] || tile.status);
    statusEl.textContent = label;
    statusEl.className = `tile-status${tile.status === 'ignored' ? ' status-ignored' : ''}`;
  }

  // Aria
  const label = tile.status === 'ignored'
    ? tile.ignoredText || 'Being ignored'
    : (STATUS_LABELS[tile.status] || tile.status);
  el.setAttribute('aria-label', `${tile.name} — ${label}`);
}

/**
 * Create a new tile DOM element.
 */
function createTileEl(tile, index) {
  const el = document.createElement('div');
  el.className = `tile entering${tile.isActive ? ' active' : ''}`;
  el.style.setProperty('--tile-color', tile.themeColor);
  el.tabIndex = 0;
  el.dataset.name = tile.name;
  el.setAttribute('role', 'button');

  const timeStr = formatRelativeTime(tile.lastActivity);
  const statusLabel = tile.status === 'ignored'
    ? (tile.ignoredText || 'Being ignored :(')
    : (STATUS_LABELS[tile.status] || tile.status);
  const dotClass = tile.status === 'ignored' ? 'ignored' : tile.status;

  let ctxHtml = '';
  if (tile.contextPercent !== undefined && tile.contextPercent > 0) {
    const ctxClass = tile.contextPercent >= 80 ? 'ctx-crit' : tile.contextPercent >= 60 ? 'ctx-warn' : '';
    ctxHtml = `<span class="tile-ctx ${ctxClass}">ctx ${tile.contextPercent}%</span>`;
  }

  el.innerHTML = `
    <div class="tile-header">
      <span class="dot ${dotClass}"></span>
      <span class="tile-name">${escapeHtml(tile.name)}</span>
      ${tile.status !== 'idle' ? `<span class="tile-time">${timeStr}</span>` : '<span class="tile-time"></span>'}
      ${ctxHtml}
    </div>
    <div class="tile-status${tile.status === 'ignored' ? ' status-ignored' : ''}">${statusLabel}</div>
  `;

  el.setAttribute('aria-label', `${tile.name} — ${statusLabel}`);

  el.addEventListener('click', () => {
    vscode.postMessage({ type: 'switchTerminal', name: tile.name });
  });

  el.addEventListener('focus', () => {
    selectedIndex = index;
  });

  return el;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);

  if (diff < 5) return 'now';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
