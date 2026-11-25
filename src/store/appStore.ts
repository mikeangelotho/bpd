import { createStore, produce, unwrap } from 'solid-js/store';
import type {
  AppState,
  WatcherState,
  WatcherEvent,
  Alert,
  BackgroundType,
  SemanticFilter,
  FilterMatch,
  View,
  ViewMode,
} from '../types';
import { runFilterEngine } from '../engine/filterEngine';
import { getAllPlugins } from '../engine/pluginRegistry';
import { saveToIndexedDB, loadFromIndexedDB } from './persistence';

// ─── SEMANTIC FILTER PRESETS ───
export const PRESET_FILTERS: SemanticFilter[] = [
  {
    id: 'ai-ml',
    name: 'AI / ML',
    description: 'Artificial intelligence, machine learning, LLMs',
    keywords: ['AI', 'LLM', 'GPT', 'Claude', 'Gemini', 'transformer', 'neural', 'machine learning', 'deep learning', 'model training', 'fine-tuning', 'RAG', 'agent', 'autonomous'],
    regexPatterns: [],
  },
  {
    id: 'crypto',
    name: 'Crypto',
    description: 'Cryptocurrency, DeFi, blockchain',
    keywords: ['Bitcoin', 'BTC', 'Ethereum', 'ETH', 'DeFi', 'whale', 'blockchain', 'token', 'NFT', 'solana', 'altcoin', 'bull', 'bear', 'rally', 'crash', 'halving', 'ETF'],
    regexPatterns: [
      '[$€£]\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*(?:BTC|ETH|SOL)',
      '(?:up|down|surge|plunge|spike)\\s+\\d+%',
    ],
  },
  {
    id: 'stocks',
    name: 'Stocks',
    description: 'Stock market, earnings, IPOs',
    keywords: ['earnings', 'IPO', 'dividend', 'buyback', 'SEC filing', 'market cap', 'S&P 500', 'NASDAQ', 'Dow', 'Fed', 'interest rate', 'inflation', 'recession'],
    regexPatterns: [
      '(?:NVDA|AAPL|MSFT|GOOG|AMZN|TSLA|META|AMD)\\s+(?:up|down|gains|loses|rises|falls)',
      '[$€£]\\d{1,3}(?:\\.\\d+)?(?:B|M)\\s*(?:market cap|valuation)',
    ],
  },
  {
    id: 'tech',
    name: 'Tech',
    description: 'Technology industry, startups, software',
    keywords: ['startup', 'funding', 'Series A', 'Series B', 'seed round', 'acquisition', 'layoffs', 'hiring', 'product launch', 'open source', 'developer', 'framework', 'API'],
    regexPatterns: [
      'raises\\s+[$€£]\\d+M',
      'acquires\\s+\\w+',
      'version\\s+\\d+\\.\\d+\\.\\d+',
    ],
  },
  {
    id: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'Vulnerabilities, breaches, exploits',
    keywords: ['CVE', 'exploit', 'zero-day', 'breach', 'ransomware', 'malware', 'phishing', 'vulnerability', 'patch', 'security advisory', 'data leak', 'attack'],
    regexPatterns: [
      'CVE-\\d{4}-\\d{4,}',
      '(?:critical|high)\\s+(?:severity|vulnerability)',
    ],
  },
];

// ─── INITIAL STATE ───
const initialState: AppState = {
  watchers: {},
  alerts: [],
  dashboard: {
    background: 'grid',
  },
  activeFilter: null,
  selectedWatcher: null,
  currentView: 'dashboard',
  viewMode: 'grid',
  expandedWatcher: null,
  maximizedWatcher: null,
  sidebarCollapsed: false,
  topbarHidden: false,
  editingWatcherId: null,
  focusMode: false,
};

// ─── STORE ───
const [state, setState] = createStore<AppState>(initialState);

export { state, setState };

// ─── ACTIONS ───

export function setWatcher(id: string, watcher: Partial<WatcherState>) {
  setState('watchers', id, watcher);
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function removeWatcher(id: string) {
  setState('watchers', produce((s) => {
    delete s[id];
  }));
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function pushWatcherEvent(id: string, event: WatcherEvent) {
  pushWatcherEvents(id, [event]);
}

export function pushWatcherEvents(id: string, events: WatcherEvent[]) {
  if (events.length === 0) return;

  const now = Date.now();
  const lastEvent = events[events.length - 1];

  // Batch append events in one store update
  setState('watchers', id, 'events', (existing) => {
    const merged = [...existing, ...events];
    return merged.length > 200 ? merged.slice(-200) : merged;
  });
  setState('watchers', id, {
    lastFetch: now,
    status: lastEvent.type === 'error' ? 'error' : 'ok',
    retryCount: 0,
    retryDelay: 1000,
  });

  // Run semantic filters on batched events
  const alerts: Alert[] = [];
  for (const event of events) {
    const matches = runFilterEngine(event, PRESET_FILTERS);
    for (const match of matches) {
      alerts.push({
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        watcherId: id,
        watcherName: unwrap(state.watchers[id]?.name) || id,
        timestamp: event.timestamp,
        message: buildAlertMessage(match),
        severity: match.event.severity || 'info',
        acknowledged: false,
      });
    }
  }
  if (alerts.length > 0) {
    setState('alerts', (a) => [...a.slice(-99), ...alerts]);
  }

  saveToIndexedDB('watchers', unwrap(state.watchers));
}

function buildAlertMessage(match: FilterMatch): string {
  const p = match.event.payload;
  const title = String(p.title || p.name || p.headline || p.symbol || '').slice(0, 80);
  const keywords = match.matchedKeywords.slice(0, 3).join(', ');
  if (title) return `${title} [${keywords}]`;
  if (keywords) return `Match: ${keywords}`;
  return `Event from ${match.event.watcherId}`;
}

export function setWatcherStatus(id: string, status: WatcherState['status'], error?: string) {
  setState('watchers', id, { status, lastError: error });
}

export function acknowledgeAlert(alertId: string) {
  setState('alerts', (alerts) =>
    alerts.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
  );
}

export function clearAcknowledgedAlerts() {
  setState('alerts', (alerts) => alerts.filter((a) => !a.acknowledged));
}

export function setBackground(bg: BackgroundType) {
  setState('dashboard', 'background', bg);
  saveToIndexedDB('dashboard', unwrap(state.dashboard));
}

export function setActiveFilter(filterId: string | null) {
  setState('activeFilter', filterId);
}

export function setSelectedWatcher(id: string | null) {
  setState('selectedWatcher', id);
}

export function setCurrentView(view: View) {
  setState('currentView', view);
}

export function setViewMode(mode: ViewMode) {
  setState('viewMode', mode);
}

export function setExpandedWatcher(id: string | null) {
  setState('expandedWatcher', id);
  // Also switch to grid view mode when closing
  if (id === null) setState('viewMode', 'grid');
}

// ─── REORDERING ───

export function reorderWatchers(sortedIds: string[]) {
  sortedIds.forEach((id, idx) => {
    if (state.watchers[id]) {
      setState('watchers', id, 'order', idx);
    }
  });
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function moveWatcher(id: string, direction: 'up' | 'down') {
  const allWatchers = getOrderedWatchers();
  const idx = allWatchers.findIndex((w) => w.id === id);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= allWatchers.length) return;
  const orderA = allWatchers[idx].order ?? idx;
  const orderB = allWatchers[swapIdx].order ?? swapIdx;
  setState('watchers', allWatchers[idx].id, 'order', orderB);
  setState('watchers', allWatchers[swapIdx].id, 'order', orderA);
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function getOrderedWatchers(): WatcherState[] {
  return Object.values(state.watchers).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// ─── WINDOW-MANAGER LAYOUT ───
// Windows tile in a CSS grid. Layout lives entirely in grid coordinates so moving/
// resizing only mutates styles (never DOM order) — see Dashboard's stable-keyed <For>.

export const GRID_COLS = 4;

export interface WindowLayout {
  gridCol: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}

// Resolve a watcher's effective layout, deriving a default from `order` for watchers
// persisted before the window manager existed, and clamping to stay on-grid.
export function ensureLayout(w: WatcherState, cols: number = GRID_COLS): WindowLayout {
  const colSpan = Math.max(1, Math.min(w.colSpan ?? 1, cols));
  const rowSpan = Math.max(1, w.rowSpan ?? 1);
  let gridCol: number;
  let gridRow: number;
  if (w.gridCol != null && w.gridRow != null) {
    gridCol = w.gridCol;
    gridRow = w.gridRow;
  } else {
    const order = w.order ?? 0;
    gridCol = order % cols;
    gridRow = Math.floor(order / cols);
  }
  gridCol = Math.max(0, Math.min(gridCol, cols - colSpan));
  gridRow = Math.max(0, gridRow);
  return { gridCol, gridRow, colSpan, rowSpan };
}

export function setWindowLayout(id: string, patch: Partial<WindowLayout>) {
  if (!state.watchers[id]) return;
  setState('watchers', id, patch);
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

// Move a window's top-left to (col,row). FancyZones-style swap: if another window covers
// the target cell, exchange the two windows' origins (each keeps its own span).
export function moveWindowToCell(id: string, col: number, row: number, cols: number = GRID_COLS) {
  const w = state.watchers[id];
  if (!w) return;
  const me = ensureLayout(w, cols);
  const targetCol = Math.max(0, Math.min(col, cols - me.colSpan));
  const targetRow = Math.max(0, row);

  const occupantId = Object.keys(state.watchers).find((oid) => {
    if (oid === id) return false;
    const o = state.watchers[oid];
    if (o.minimized) return false;
    const ol = ensureLayout(o, cols);
    return (
      targetCol >= ol.gridCol && targetCol < ol.gridCol + ol.colSpan &&
      targetRow >= ol.gridRow && targetRow < ol.gridRow + ol.rowSpan
    );
  });

  if (occupantId) {
    const o = ensureLayout(state.watchers[occupantId], cols);
    const occCol = Math.max(0, Math.min(me.gridCol, cols - o.colSpan));
    setState('watchers', occupantId, { gridCol: occCol, gridRow: me.gridRow });
    setState('watchers', id, { gridCol: targetCol, gridRow: targetRow });
  } else {
    setState('watchers', id, { gridCol: targetCol, gridRow: targetRow });
  }
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function resizeWindow(id: string, colSpan: number, rowSpan: number, cols: number = GRID_COLS) {
  const w = state.watchers[id];
  if (!w) return;
  const me = ensureLayout(w, cols);
  const cs = Math.max(1, Math.min(colSpan, cols - me.gridCol));
  const rs = Math.max(1, rowSpan);
  setState('watchers', id, { colSpan: cs, rowSpan: rs });
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function minimizeWindow(id: string) {
  if (!state.watchers[id]) return;
  setState('watchers', id, { minimized: true });
  if (state.maximizedWatcher === id) setState('maximizedWatcher', null);
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function restoreWindow(id: string) {
  if (!state.watchers[id]) return;
  setState('watchers', id, { minimized: false });
  saveToIndexedDB('watchers', unwrap(state.watchers));
}

export function toggleMaximize(id: string) {
  setState('maximizedWatcher', (cur) => (cur === id ? null : id));
}

// ─── PERSISTENCE RESTORE ───

export async function restoreFromPersistence() {
  try {
    const [watchers, dashboard, focusMode] = await Promise.all([
      loadFromIndexedDB<Record<string, WatcherState>>('watchers'),
      loadFromIndexedDB<{ background: BackgroundType }>('dashboard'),
      loadFromIndexedDB<boolean>('focusMode'),
    ]);

    if (watchers && Object.keys(watchers).length > 0) {
      setState('watchers', produce((s) => {
        Object.assign(s, watchers);
      }));
    }
    if (dashboard) {
      setState('dashboard', (d) => ({ ...d, ...dashboard }));
    }
    if (typeof focusMode === 'boolean') {
      setState('focusMode', focusMode);
    }
  } catch {
    // First run — no persisted state
  }
}

// ─── SHARED WATCHER FETCH RUNNER ───
// Single implementation of "poll this watcher once" used by every scheduling call site
// (initial add, edit, AI-tool add, and reschedule-on-restore). Reads config fresh from
// the store each run, applies plugin schema defaults, chunks large event batches to keep
// the UI responsive, and records ok/error/empty status consistently.
export async function runWatcherFetch(id: string): Promise<void> {
  const w = state.watchers[id];
  if (!w) return;

  const reg = getAllPlugins().find((p) => p.plugin.id === w.pluginId);
  if (!reg) {
    setWatcher(id, { status: 'error', lastError: `Plugin "${w.pluginId}" not registered` });
    return;
  }

  // Apply schema defaults over the stored config (handles older watchers missing fields).
  const schema = reg.plugin.configSchema as Record<string, { default?: unknown }>;
  const config: Record<string, unknown> = { ...unwrap(w.config) };
  for (const [key, field] of Object.entries(schema)) {
    if (config[key] === undefined && field.default !== undefined) {
      config[key] = field.default;
    }
  }

  setWatcher(id, { status: 'loading' });
  try {
    const raw = await reg.plugin.fetch(config);
    const events = reg.plugin.parse(raw, config);

    // Chunk large batches (OpenSky can return 1000+ aircraft) so we yield to the
    // browser between store updates and never freeze the main thread.
    const CHUNK = 50;
    for (let i = 0; i < events.length; i += CHUNK) {
      const chunk = events.slice(i, i + CHUNK);
      for (const ev of chunk) ev.watcherId = id;
      pushWatcherEvents(id, chunk);
      if (i + CHUNK < events.length) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // pushWatcherEvents marks status/lastFetch, but a legitimately empty result would
    // otherwise leave the card stuck on "loading" — record success explicitly.
    if (events.length === 0) {
      setWatcher(id, { status: 'ok', lastFetch: Date.now() });
    }
  } catch (err) {
    setWatcher(id, { status: 'error', lastError: String(err) });
  }
}

// ─── RESCHEDULE ALL WATCHERS ───
// Called after persistence restore to restart polling for all active watchers.
// Must be invoked from the component layer (after plugins are registered).
export function rescheduleAllWatchers(
  scheduleFn: (
    id: string,
    interval: number,
    fetchFn: () => Promise<void>,
    scheduleMode?: 'interval' | 'cron',
    cron?: string,
  ) => void,
) {
  for (const [id, w] of Object.entries(state.watchers)) {
    if (w.status === 'loading') continue; // skip in-flight

    const reg = getAllPlugins().find((p) => p.plugin.id === w.pluginId);
    if (!reg) continue;

    scheduleFn(
      id,
      w.interval,
      () => runWatcherFetch(id),
      w.scheduleMode || 'interval',
      w.cron,
    );
  }
}

// ─── UI TOGGLES ───
export function toggleSidebar() {
  setState('sidebarCollapsed', (v) => !v);
}

export function toggleTopbar() {
  setState('topbarHidden', (v) => !v);
}

export function setEditingWatcherId(id: string | null) {
  setState('editingWatcherId', id);
}

export function toggleFocusMode() {
  setState('focusMode', (v) => !v);
}
