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

// ─── RESCHEDULE ALL WATCHERS ───
// Called after persistence restore to restart polling for all active watchers.
// Must be invoked from the component layer (after plugins are registered).
// Pass the getAllPlugins function to avoid circular deps.
export function rescheduleAllWatchers(
  scheduleFn: (
    id: string,
    interval: number,
    fetchFn: () => Promise<void>,
    scheduleMode?: 'interval' | 'cron',
    cron?: string,
  ) => void,
  getAllPluginsFn: () => Array<{ plugin: { id: string; fetch: (c: Record<string, unknown>) => Promise<unknown>; parse: (r: unknown, c: Record<string, unknown>) => import('../types').WatcherEvent[]; configSchema: Record<string, { default?: unknown }> } }>,
) {
  const plugins = getAllPluginsFn();
  if (!plugins.length) return;

  for (const [id, w] of Object.entries(state.watchers)) {
    if (w.status === 'loading') continue; // skip in-flight

    const plugin = plugins.find((p) => p.plugin.id === w.pluginId);
    if (!plugin) continue;

    const config = { ...w.config };
    // Apply schema defaults
    const schema = plugin.plugin.configSchema;
    for (const [key, field] of Object.entries(schema)) {
      if (config[key] === undefined && field.default !== undefined) {
        config[key] = field.default;
      }
    }

    scheduleFn(
      id,
      w.interval,
      async () => {
        const reg = plugins.find((p) => p.plugin.id === plugin!.plugin.id);
        if (!reg) return;
        setWatcher(id, { status: 'loading' });
        try {
          const raw = await reg.plugin.fetch(config);
          const events = reg.plugin.parse(raw, config);
          for (const ev of events) {
            ev.watcherId = id;
            pushWatcherEvent(id, ev);
          }
        } catch (err) {
          setWatcher(id, { status: 'error', lastError: String(err) });
        }
      },
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
