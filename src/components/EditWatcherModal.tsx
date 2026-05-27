import { type Component, For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { state, setWatcher, setEditingWatcherId, pushWatcherEvent } from '../store/appStore';
import { getAllPlugins, cancelWatcher, scheduleWatcher, describeCron } from '../engine/pluginRegistry';
import type { WatcherState } from '../types';

interface Props {
  watcher: WatcherState;
  onClose: () => void;
}

const cronPresets = [
  { label: 'Every 5 min', value: '*/5 * * * *' },
  { label: 'Every 15 min', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily 9AM', value: '0 9 * * *' },
  { label: 'Daily noon', value: '0 12 * * *' },
  { label: 'Daily midnight', value: '0 0 * * *' },
  { label: 'Weekdays 9:30AM', value: '30 9 * * 1-5' },
  { label: 'Tue midnight', value: '0 0 * * 2' },
  { label: '1st of month 9AM', value: '0 9 1 * *' },
];

// Apply schema defaults to config so required fields like 'mode' are populated
function applySchemaDefaults(
  config: Record<string, unknown>,
  schema: Record<string, { default?: unknown }>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...config };
  for (const [key, field] of Object.entries(schema)) {
    if (merged[key] === undefined && field.default !== undefined) {
      merged[key] = field.default;
    }
  }
  return merged;
}

// Build a fetch function that reads config from the STORE (not local signals)
// so it survives modal close and always uses latest persisted state.
function buildFetchFn(
  watcherId: string,
  pluginId: string,
): () => Promise<void> {
  return async () => {
    // Read current config from the store — always fresh
    const w = state.watchers[watcherId];
    if (!w) return;

    const pluginReg = getAllPlugins().find((p) => p.plugin.id === pluginId);
    if (!pluginReg) return;

    // Apply schema defaults at fetch time (handles old watchers missing fields)
    const schema = pluginReg.plugin.configSchema as Record<string, { default?: unknown }>;
    const config = applySchemaDefaults({ ...w.config }, schema);

    setWatcher(watcherId, { status: 'loading' });
    try {
      const raw = await pluginReg.plugin.fetch(config);
      const events = pluginReg.plugin.parse(raw, config);
      for (const ev of events) {
        ev.watcherId = watcherId;
        pushWatcherEvent(watcherId, ev);
      }
    } catch (err) {
      setWatcher(watcherId, { status: 'error', lastError: String(err) });
    }
  };
}

export const EditWatcherModal: Component<Props> = (props) => {
  const plugins = getAllPlugins();
  const w = () => props.watcher;
  const plugin = createMemo(() => plugins.find((p) => p.plugin.id === w().pluginId));

  // Initialize config with schema defaults (critical for crypto mode, etc.)
  const schemaDefaults = createMemo(() => {
    const p = plugin();
    return p ? (p.plugin.configSchema as Record<string, { default?: unknown }>) : {};
  });
  const initialConfig = applySchemaDefaults(w().config, schemaDefaults());

  const [name, setName] = createSignal(w().name);
  const [config, setConfig] = createSignal<Record<string, unknown>>(initialConfig);
  const [interval, setInterval_] = createSignal<number>(w().interval);
  const [scheduleMode, setScheduleMode] = createSignal<'interval' | 'cron'>(w().scheduleMode || 'interval');
  const [cron, setCron] = createSignal<string>(w().cron || '');

  function handleSave() {
    cancelWatcher(w().id);

    setWatcher(w().id, {
      name: name(),
      config: config(),
      interval: interval(),
      scheduleMode: scheduleMode(),
      cron: scheduleMode() === 'cron' ? (cron() || '0 * * * *') : undefined,
    });

    const p = plugin();
    if (p) {
      scheduleWatcher(
        w().id,
        interval(),
        buildFetchFn(w().id, p.plugin.id),
        scheduleMode(),
        scheduleMode() === 'cron' ? cron() : undefined,
      );
    }

    props.onClose();
  }

  function handleReset() {
    cancelWatcher(w().id);
    setWatcher(w().id, { events: [], status: 'idle', lastError: undefined });

    const p = plugin();
    if (p) {
      scheduleWatcher(
        w().id,
        interval(),
        buildFetchFn(w().id, p.plugin.id),
        scheduleMode(),
        scheduleMode() === 'cron' ? cron() : undefined,
      );
    }

    props.onClose();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'z-index': 200,
      }}
      onClick={props.onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          width: '420px',
          'max-height': '80vh',
          'overflow-y': 'auto',
          padding: '20px',
          'font-size': '11px',
          'clip-path': 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
        }}
      >
        <div style={{ color: 'var(--accent-cyan)', 'font-size': '12px', 'font-weight': 600, 'text-transform': 'uppercase', 'letter-spacing': '0.1em', 'margin-bottom': '16px' }}>
          Edit: {w().name}
        </div>

        {/* Name */}
        <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>Name</label>
        <input
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          style={{
            width: '100%',
            padding: '4px 8px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            'font-family': 'var(--font-mono)',
            'font-size': '11px',
            'margin-bottom': '12px',
          }}
        />

        {/* Schedule mode */}
        <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>Schedule</label>
        <select
          value={scheduleMode()}
          onChange={(e) => setScheduleMode(e.currentTarget.value as 'interval' | 'cron')}
          style={{
            width: '100%',
            padding: '4px 8px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            'font-family': 'var(--font-mono)',
            'font-size': '11px',
            'margin-bottom': '12px',
          }}
        >
          <option value="interval">Interval</option>
          <option value="cron">Cron</option>
        </select>

        {/* Interval */}
        <Show when={scheduleMode() === 'interval'}>
          <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>
            Every {Math.round(interval() / 1000)}s
          </label>
          <input
            type="range"
            min="5000"
            max="3600000"
            step="5000"
            value={interval()}
            onInput={(e) => setInterval_(Number(e.currentTarget.value))}
            style={{ width: '100%', 'margin-bottom': '12px' }}
          />
        </Show>

        {/* Cron */}
        <Show when={scheduleMode() === 'cron'}>
          <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>Cron expression</label>
          <input
            type="text"
            value={cron()}
            onInput={(e) => setCron(e.currentTarget.value)}
            placeholder="* * * * *"
            style={{
              width: '100%',
              padding: '4px 8px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              'font-family': 'var(--font-mono)',
              'font-size': '11px',
              'margin-bottom': '6px',
            }}
          />
          <div style={{ display: 'flex', gap: '3px', 'flex-wrap': 'wrap', 'margin-bottom': '4px' }}>
            <For each={cronPresets}>
              {(preset) => (
                <button
                  onClick={() => setCron(preset.value)}
                  style={{
                    background: cron() === preset.value ? 'rgba(0, 229, 255, 0.1)' : 'transparent',
                    border: `1px solid ${cron() === preset.value ? 'var(--accent-cyan)' : 'var(--border)'}`,
                    color: cron() === preset.value ? 'var(--accent-cyan)' : 'var(--text-dim)',
                    'font-family': 'var(--font-mono)',
                    'font-size': '9px',
                    padding: '1px 4px',
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              )}
            </For>
          </div>
          <Show when={cron()}>
            <div style={{ color: 'var(--accent-cyan)', 'font-size': '9px', 'margin-bottom': '12px' }}>
              → {describeCron(cron())}
            </div>
          </Show>
        </Show>

        {/* Plugin-specific config */}
        <Show when={plugin()}>
          {(() => {
            const p = plugin()!;
            const schema = p.plugin.configSchema as Record<string, { label: string; type: string; placeholder?: string; options?: string[]; default?: unknown; required?: boolean }>;

            return (
              <div style={{ 'margin-bottom': '12px' }}>
                <div style={{ color: 'var(--text-muted)', 'margin-bottom': '6px', 'text-transform': 'uppercase', 'letter-spacing': '0.05em', 'font-size': '10px' }}>Configuration</div>
                <For each={Object.entries(schema)}>
                  {([key, field]) => (
                    <div style={{ 'margin-bottom': '8px' }}>
                      <label style={{ color: 'var(--text-muted)', 'font-size': '10px', display: 'block', 'margin-bottom': '2px' }}>
                        {field.label}{field.required ? ' *' : ''}
                      </label>
                      {field.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={(config()[key] as boolean) ?? (field.default as boolean) ?? false}
                          onChange={(e) => setConfig((c) => ({ ...c, [key]: e.currentTarget.checked }))}
                        />
                      ) : field.options ? (
                        <select
                          value={(config()[key] as string) ?? (field.default as string) ?? ''}
                          onChange={(e) => setConfig((c) => ({ ...c, [key]: e.currentTarget.value }))}
                          style={{
                            width: '100%',
                            padding: '3px 6px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            'font-family': 'var(--font-mono)',
                            'font-size': '10px',
                          }}
                        >
                          <For each={field.options}>
                            {(opt) => <option value={opt}>{opt}</option>}
                          </For>
                        </select>
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={(config()[key] as string | number) ?? (field.default as string | number) ?? ''}
                          onInput={(e) => setConfig((c) => ({ ...c, [key]: field.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value }))}
                          placeholder={field.placeholder}
                          style={{
                            width: '100%',
                            padding: '3px 6px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            'font-family': 'var(--font-mono)',
                            'font-size': '10px',
                          }}
                        />
                      )}
                    </div>
                  )}
                </For>
              </div>
            );
          })()}
        </Show>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', 'margin-top': '16px' }}>
          <button
            onClick={props.onClose}
            style={{
              flex: 1,
              padding: '6px',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              'font-family': 'var(--font-mono)',
              'font-size': '10px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              padding: '6px',
              background: 'transparent',
              border: '1px solid var(--accent-amber)',
              color: 'var(--accent-amber)',
              'font-family': 'var(--font-mono)',
              'font-size': '10px',
              cursor: 'pointer',
            }}
          >
            Clear & Retry
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: '6px',
              background: 'rgba(0, 229, 255, 0.1)',
              border: '1px solid var(--accent-cyan)',
              color: 'var(--accent-cyan)',
              'font-family': 'var(--font-mono)',
              'font-size': '10px',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
