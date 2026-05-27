import { render } from 'solid-js/web';
import { App } from './App';
import { restoreFromPersistence, rescheduleAllWatchers, state, setWatcher, removeWatcher, pushWatcherEvents, setActiveFilter, PRESET_FILTERS } from './store/appStore';
import { registerBuiltinPlugins } from './plugins';
import { scheduleWatcher, getAllPlugins, refreshWatcher } from './engine/pluginRegistry';
import { initAI } from './ai';
import './styles/variables.css';

// Register all built-in plugins
registerBuiltinPlugins();

// Restore persisted state, re-schedule watchers, then mount
restoreFromPersistence().then(() => {
  // Restart polling for all persisted watchers
  rescheduleAllWatchers(scheduleWatcher, getAllPlugins);

  // ─── INITIALIZE AI AGENT ───
  // Query Ollama for available models, pick one, then init the agent.
  // The AI module never imports SolidJS directly — it only sees plain functions.
  async function initAIWithModelDiscovery() {
    let chosenModel = 'llama3.2'; // fallback
    try {
      const resp = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.models || []).map((m: any) => m.name);
        if (models.length > 0) {
          // Prefer a capable model if available, otherwise first
          chosenModel = models.find((m: string) => m.includes('qwen') || m.includes('granite') || m.includes('llama')) || models[0];
          console.log(`[ai] Discovered ${models.length} models, using: ${chosenModel}`);
        }
      }
    } catch {
      console.warn('[ai] Could not reach Ollama, using fallback model:', chosenModel);
    }

    initAI({
      getWatchers: () => ({ ...state.watchers }),
      getAlerts: () => [...state.alerts],
      getAllEvents: () => {
        const all: typeof state.alerts = []; // WatcherEvent[]
        for (const w of Object.values(state.watchers)) {
          all.push(...w.events);
        }
        return all;
      },
      addWatcher: (id, name, pluginId, config, interval) => {
        setWatcher(id, {
          name,
          pluginId,
          config,
          interval,
          status: 'idle',
          events: [],
          lastFetch: 0,
          retryCount: 0,
          retryDelay: 1000,
          nextRetry: 0,
          order: Object.keys(state.watchers).length,
          scheduleMode: 'interval',
        });
        // Schedule the new watcher
        const plugins = getAllPlugins();
        const plugin = plugins.find((p) => p.plugin.id === pluginId);
        if (plugin) {
          const mergedConfig = { ...config };
          for (const [key, field] of Object.entries(plugin.plugin.configSchema as Record<string, { default?: unknown }>)) {
            if (mergedConfig[key] === undefined && field.default !== undefined) {
              mergedConfig[key] = field.default;
            }
          }
          scheduleWatcher(id, interval, async () => {
            setWatcher(id, { status: 'loading' });
            try {
              const raw = await plugin.plugin.fetch(mergedConfig);
              const events = plugin.plugin.parse(raw, mergedConfig);

              // Push events in chunks of 50 to avoid blocking the main thread.
              // OpenSky can return 1000+ aircraft — processing all at once freezes the UI.
              const CHUNK = 50;
              for (let i = 0; i < events.length; i += CHUNK) {
                const chunk = events.slice(i, i + CHUNK);
                for (const ev of chunk) {
                  ev.watcherId = id;
                }
                pushWatcherEvents(id, chunk);
                // Yield to the browser between chunks so the UI stays responsive.
                if (i + CHUNK < events.length) {
                  await new Promise((r) => setTimeout(r, 0));
                }
              }
            } catch (err) {
              setWatcher(id, { status: 'error', lastError: String(err) });
            }
          });
        }
      },
      removeWatcher,
      refreshWatcher,
      getPlugins: () => {
        const plugins = getAllPlugins();
        return plugins.map((p) => ({
          id: p.plugin.id,
          name: p.plugin.name,
          configSchema: p.plugin.configSchema,
          defaultInterval: p.plugin.defaultInterval,
        }));
      },
      setActiveFilter,
      getPresetFilters: () => PRESET_FILTERS,
    }, {
      model: chosenModel,
      maxToolIterations: 5,
    });
  }

  initAIWithModelDiscovery();

  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  render(() => <App />, root);
});
