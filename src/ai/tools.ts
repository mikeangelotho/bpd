import type { Tool } from './types';
import type { WatcherState, WatcherEvent, Alert } from '../types';

// ─── TOOL REGISTRY ───
// Tools are the bridge between the AI and the app.
// Each tool wraps an app store action or data query.
// The registry is created with references to the actual store/actions.

interface StoreActions {
  /** Get all watchers */
  getWatchers: () => Record<string, WatcherState>;
  /** Get all alerts */
  getAlerts: () => Alert[];
  /** Get all events across all watchers */
  getAllEvents: () => WatcherEvent[];
  /** Add a new watcher */
  addWatcher: (id: string, name: string, pluginId: string, config: Record<string, unknown>, interval: number) => void;
  /** Remove a watcher */
  removeWatcher: (id: string) => void;
  /** Refresh a watcher immediately */
  refreshWatcher: (id: string) => Promise<void>;
  /** List registered plugins */
  getPlugins: () => Array<{ id: string; name: string; configSchema: Record<string, unknown>; defaultInterval: number }>;
  /** Set active semantic filter */
  setActiveFilter: (filterId: string | null) => void;
  /** Get preset filter definitions */
  getPresetFilters: () => Array<{ id: string; name: string; description: string; keywords: string[] }>;
}

/**
 * Create the full tool set for the AI agent.
 * Pass the store accessors and action dispatchers.
 */
export function createTools(store: StoreActions): Tool[] {
  return [
    // ─── READ TOOLS ───

    {
      name: 'get_watchers',
      description: 'List all active watchers with their status, plugin type, configuration, and event counts. Use this to understand what the dashboard is currently monitoring.',
      parameters: {},
      execute: async (): Promise<string> => {
        const watchers = store.getWatchers();
        const entries = Object.entries(watchers);
        if (entries.length === 0) {
          return 'No watchers configured. Use add_watcher to start monitoring something.';
        }
        const lines = entries.map(([id, w]) => {
          const lastFetch = w.lastFetch ? new Date(w.lastFetch).toISOString() : 'never';
          return [
            `ID: ${id}`,
            `  Name: ${w.name}`,
            `  Plugin: ${w.pluginId}`,
            `  Status: ${w.status}`,
            `  Events: ${w.events.length}`,
            `  Interval: ${w.interval}ms`,
            `  Last fetch: ${lastFetch}`,
            `  Config: ${JSON.stringify(w.config)}`,
          ].join('\n');
        });
        return `Found ${entries.length} watcher(s):\n\n${lines.join('\n\n')}`;
      },
    },

    {
      name: 'get_events',
      description: 'Get recent events from a specific watcher or all watchers. Returns the most recent N events sorted by timestamp.',
      parameters: {
        watcherId: { type: 'string', description: 'Watcher ID to get events from. Omit for all watchers.' },
        limit: { type: 'number', description: 'Maximum number of events to return (default: 20).' },
      },
      execute: async (args): Promise<string> => {
        const limit = Math.min(Number(args.limit) || 20, 100);
        let events = store.getAllEvents();

        if (args.watcherId) {
          events = events.filter((e) => e.watcherId === args.watcherId);
        }

        // Sort by timestamp descending, take limit
        events = events
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);

        if (events.length === 0) {
          return args.watcherId
            ? `No events found for watcher "${args.watcherId}".`
            : 'No events found across all watchers.';
        }

        const lines = events.map((e) => {
          const p = e.payload;
          const time = new Date(e.timestamp).toISOString();
          const summary = Object.entries(p)
            .slice(0, 6)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          return `[${time}] ${e.severity || 'info'} | ${e.type} | ${summary}`;
        });

        return `${events.length} event(s):\n\n${lines.join('\n')}`;
      },
    },

    {
      name: 'get_alerts',
      description: 'Get current alerts. Shows unacknowledged and acknowledged alerts with severity and messages.',
      parameters: {
        unackOnly: { type: 'boolean', description: 'Only show unacknowledged alerts (default: false).' },
        limit: { type: 'number', description: 'Maximum number of alerts to return (default: 20).' },
      },
      execute: async (args): Promise<string> => {
        const limit = Math.min(Number(args.limit) || 20, 100);
        let alerts = store.getAlerts();

        if (args.unackOnly) {
          alerts = alerts.filter((a) => !a.acknowledged);
        }

        alerts = alerts.slice(-limit).reverse();

        if (alerts.length === 0) {
          return args.unackOnly ? 'No unacknowledged alerts.' : 'No alerts.';
        }

        const lines = alerts.map((a) => {
          const time = new Date(a.timestamp).toISOString();
          const ack = a.acknowledged ? '[ACK]' : '[NEW]';
          return `[${time}] ${ack} ${a.severity} | ${a.watcherName}: ${a.message}`;
        });

        return `${alerts.length} alert(s):\n\n${lines.join('\n')}`;
      },
    },

    {
      name: 'get_dashboard_summary',
      description: 'Get a high-level summary of the entire dashboard: watcher counts by status, total events, alert counts, active filters.',
      parameters: {},
      execute: async (): Promise<string> => {
        const watchers = store.getWatchers();
        const alerts = store.getAlerts();
        const events = store.getAllEvents();

        const byStatus: Record<string, number> = {};
        for (const w of Object.values(watchers)) {
          byStatus[w.status] = (byStatus[w.status] || 0) + 1;
        }

        const byPlugin: Record<string, number> = {};
        for (const w of Object.values(watchers)) {
          byPlugin[w.pluginId] = (byPlugin[w.pluginId] || 0) + 1;
        }

        const unackedAlerts = alerts.filter((a) => !a.acknowledged).length;

        return [
          `Dashboard Summary:`,
          `  Total watchers: ${Object.keys(watchers).length}`,
          `  By status: ${JSON.stringify(byStatus)}`,
          `  By plugin: ${JSON.stringify(byPlugin)}`,
          `  Total events: ${events.length}`,
          `  Total alerts: ${alerts.length} (${unackedAlerts} unacknowledged)`,
        ].join('\n');
      },
    },

    {
      name: 'get_plugins',
      description: 'List all available plugins with their names, config schemas, and default intervals. Use this to understand what data sources can be added to the dashboard.',
      parameters: {},
      execute: async (): Promise<string> => {
        const plugins = store.getPlugins();
        if (plugins.length === 0) {
          return 'No plugins registered.';
        }

        const lines = plugins.map((p) => {
          const schema = p.configSchema;
          const fields = Object.entries(schema)
            .map(([k, v]: [string, any]) => `${k}: ${v.type}${v.required ? ' (required)' : ` (default: ${v.default})`}`)
            .join(', ');
          return `${p.id} — ${p.name}\n  Interval: ${p.defaultInterval}ms\n  Config: ${fields}`;
        });

        return `Available plugins:\n\n${lines.join('\n\n')}`;
      },
    },

    // ─── WRITE/ACTION TOOLS ───

    {
      name: 'add_watcher',
      description: 'Add a new watcher to the dashboard. Requires a unique ID, display name, plugin ID, and configuration matching the plugin\'s schema. Use get_plugins first to see available plugins and their config requirements.',
      parameters: {
        id: { type: 'string', description: 'Unique watcher ID. Use format "watcher-{timestamp}-{random}" or a descriptive name like "crypto-prices".' },
        name: { type: 'string', description: 'Display name for the watcher card.' },
        pluginId: { type: 'string', description: 'Plugin ID to use. Must match one from get_plugins.' },
        config: { type: 'object', description: 'Configuration object matching the plugin\'s schema. Keys and values depend on the plugin.', properties: {} },
        interval: { type: 'number', description: 'Polling interval in milliseconds. Default varies by plugin.' },
      },
      execute: async (args): Promise<string> => {
        if (!args.id || !args.name || !args.pluginId) {
          return 'ERROR: Missing required fields: id, name, pluginId.';
        }

        const plugins = store.getPlugins();
        const plugin = plugins.find((p) => p.id === args.pluginId);
        if (!plugin) {
          return `ERROR: Plugin "${args.pluginId}" not found. Available: ${plugins.map((p) => p.id).join(', ')}`;
        }

        const interval = Number(args.interval) || plugin.defaultInterval;
        const config = (args.config as Record<string, unknown>) || {};

        store.addWatcher(args.id as string, args.name as string, args.pluginId as string, config, interval);
        return `Watcher "${args.name}" added successfully with plugin "${args.pluginId}".`;
      },
    },

    {
      name: 'remove_watcher',
      description: 'Remove a watcher from the dashboard by its ID.',
      parameters: {
        id: { type: 'string', description: 'Watcher ID to remove. Use get_watchers to find IDs.' },
      },
      execute: async (args): Promise<string> => {
        if (!args.id) return 'ERROR: Missing required field: id.';

        const watchers = store.getWatchers();
        if (!watchers[args.id as string]) {
          return `ERROR: Watcher "${args.id}" not found.`;
        }

        store.removeWatcher(args.id as string);
        return `Watcher "${args.id}" removed.`;
      },
    },

    {
      name: 'refresh_watcher',
      description: 'Trigger an immediate data fetch for a specific watcher, without affecting its polling schedule.',
      parameters: {
        id: { type: 'string', description: 'Watcher ID to refresh.' },
      },
      execute: async (args): Promise<string> => {
        if (!args.id) return 'ERROR: Missing required field: id.';

        const watchers = store.getWatchers();
        if (!watchers[args.id as string]) {
          return `ERROR: Watcher "${args.id}" not found.`;
        }

        try {
          await store.refreshWatcher(args.id as string);
          return `Watcher "${args.id}" refreshed successfully.`;
        } catch (err) {
          return `ERROR refreshing watcher "${args.id}": ${String(err)}`;
        }
      },
    },

    // ─── SEARCH / FILTER TOOLS ───

    {
      name: 'search_events',
      description: 'Search across all events by keyword matching in the payload. Useful for finding specific topics, symbols, or terms across the dashboard data.',
      parameters: {
        query: { type: 'string', description: 'Search term to match against event payloads.' },
        limit: { type: 'number', description: 'Maximum results (default: 20).' },
      },
      execute: async (args): Promise<string> => {
        if (!args.query) return 'ERROR: Missing required field: query.';

        const limit = Math.min(Number(args.limit) || 20, 100);
        const query = String(args.query).toLowerCase();
        const events = store.getAllEvents();

        const matches = events
          .filter((e) => {
            const text = JSON.stringify(e.payload).toLowerCase();
            return text.includes(query);
          })
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);

        if (matches.length === 0) {
          return `No events matching "${args.query}".`;
        }

        const lines = matches.map((e) => {
          const time = new Date(e.timestamp).toISOString();
          const title = e.payload.title || e.payload.symbol || e.payload.location || '';
          return `[${time}] ${e.severity || 'info'} | ${e.watcherId} | ${title}`;
        });

        return `${matches.length} match(es) for "${args.query}":\n\n${lines.join('\n')}`;
      },
    },

    {
      name: 'get_filters',
      description: 'Get available semantic filters and which one is currently active.',
      parameters: {},
      execute: async (): Promise<string> => {
        const filters = store.getPresetFilters();
        const lines = filters.map((f) => `${f.id}: ${f.name} — ${f.description} (keywords: ${f.keywords.slice(0, 5).join(', ')}...)`);
        return `Semantic filters:\n\n${lines.join('\n')}`;
      },
    },
  ];
}
