// ═══ CORE TYPES ═══

export type Severity = 'info' | 'warn' | 'error';
export type WatcherStatus = 'idle' | 'loading' | 'ok' | 'stale' | 'error';
export type WatcherType = 'poll' | 'stream' | 'webhook';
export type BackgroundType = 'none' | 'grid' | 'gradient' | 'stars';
export type View = 'dashboard' | 'alerts' | 'plugins' | 'config';
export type ViewMode = 'grid' | 'expanded';

export interface WatcherEvent {
  id: string;
  watcherId: string;
  timestamp: number;
  type: 'data' | 'alert' | 'error';
  payload: Record<string, unknown>;
  severity?: Severity;
}

export interface WatcherState {
  id: string;
  name: string;
  pluginId: string;
  status: WatcherStatus;
  config: Record<string, unknown>;
  interval: number;           // ms between polls (legacy/simple mode)
  cron?: string;              // cron expression (e.g., '0 9 * * *', '0 0 * * 2')
  scheduleMode?: 'interval' | 'cron';
  lastFetch: number;          // epoch ms
  lastError?: string;
  events: WatcherEvent[];
  retryCount: number;
  retryDelay: number;         // ms, exponential backoff
  nextRetry: number;          // epoch ms
  order: number;              // sort position in dashboard
}

export interface Alert {
  id: string;
  watcherId: string;
  watcherName: string;
  timestamp: number;
  message: string;
  severity: Severity;
  acknowledged: boolean;
}

export interface DashboardLayout {
  background: BackgroundType;
  // Phase 2: card positions, sizes, z-order
}

export interface AppState {
  watchers: Record<string, WatcherState>;
  alerts: Alert[];
  dashboard: DashboardLayout;
  activeFilter: string | null;  // which semantic filter is active
  selectedWatcher: string | null;
  currentView: View;
  viewMode: ViewMode;
  expandedWatcher: string | null;
  sidebarCollapsed: boolean;
  topbarHidden: boolean;
  editingWatcherId: string | null;
  focusMode: boolean;
}

// ═══ PLUGIN TYPES ═══

export interface WatcherPlugin<T = unknown> {
  /** Unique plugin identifier, e.g. 'rss-feed', 'stock-api', 'url-scraper' */
  id: string;
  /** Human-readable name */
  name: string;
  /** How this plugin gets data */
  type: WatcherType;
  /** Default polling interval (ms) */
  defaultInterval: number;
  /** JSON schema for user config UI */
  configSchema: Record<string, unknown>;
  /** Fetch raw data from the source */
  fetch(config: Record<string, unknown>): Promise<T>;
  /** Parse raw data into normalized events */
  parse(raw: T, config: Record<string, unknown>): WatcherEvent[];
}

export interface PluginRegistration {
  plugin: WatcherPlugin;
  config: Record<string, unknown>;
}

// ═══ SEMANTIC FILTER TYPES ═══

export interface SemanticFilter {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  regexPatterns: string[];
  sources?: string[];       // optional: only match from these sources
  blockedSources?: string[];
}

export interface FilterMatch {
  filter: SemanticFilter;
  event: WatcherEvent;
  matchedKeywords: string[];
  matchedPatterns: string[];
}
