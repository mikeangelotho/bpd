import { type Component, For, createSignal, Show, createMemo } from 'solid-js';
import { state, setSelectedWatcher, setWatcher, removeWatcher, setBackground, pushWatcherEvent, setViewMode, setExpandedWatcher, getOrderedWatchers, setEditingWatcherId } from '../store/appStore';
import { getAllPlugins, scheduleWatcher, cancelWatcher } from '../engine/pluginRegistry';
import { PRESET_FILTERS } from '../store/appStore';
import type { WatcherState, BackgroundType } from '../types';

export const Sidebar: Component = () => {
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [activeSection, setActiveSection] = createSignal<'watchers' | 'settings'>('watchers');
  const [showBgPicker, setShowBgPicker] = createSignal(false);

  const watcherList = () => getOrderedWatchers();

  function getStatusColor(w: WatcherState): string {
    if (w.status === 'error') return 'var(--accent-red)';
    if (w.status === 'loading') return 'var(--accent-amber)';
    if (w.status === 'stale') return 'var(--accent-amber)';
    return 'var(--accent-green)';
  }

  function timeAgo(ts: number): string {
    if (!ts) return 'never';
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h`;
  }

  const bgOptions: { value: BackgroundType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'grid', label: 'Grid' },
    { value: 'gradient', label: 'Gradient' },
    { value: 'stars', label: 'Stars' },
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        'min-width': 'var(--sidebar-width)',
        background: 'var(--bg-panel)',
        'border-right': '1px solid var(--border)',
        display: 'flex',
        'flex-direction': 'column',
        'flex-shrink': 0,
        'overflow-y': 'auto',
        position: 'relative',
        'z-index': 5,
      }}
    >
      {/* Section toggle */}
      <div style={{ display: 'flex', 'border-bottom': '1px solid var(--border)' }}>
        <For each={[{ key: 'watchers' as const, label: 'WATCHERS' }, { key: 'settings' as const, label: 'SETTINGS' }]}>
          {(sec) => (
            <div
              onClick={() => setActiveSection(sec.key)}
              style={{
                flex: 1,
                padding: '6px 0',
                'font-size': '8px',
                'text-align': 'center',
                'text-transform': 'uppercase',
                'letter-spacing': '0.15em',
                color: activeSection() === sec.key ? 'var(--accent-cyan)' : 'var(--text-dim)',
                'border-bottom': `1px solid ${activeSection() === sec.key ? 'var(--accent-cyan)' : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              {sec.label}
            </div>
          )}
        </For>
      </div>

      {/* WATCHERS SECTION */}
      <Show when={activeSection() === 'watchers'}>
        <div style={{ 'flex-direction': 'column', display: 'flex', 'flex': 1, 'overflow-y': 'auto' }}>
          <For each={watcherList()}>
            {(w) => {
              const [hovered, setHovered] = createSignal(false);
              return (
                <div
                  class="sidebar-item"
                  classList={{ active: state.selectedWatcher === w.id }}
                  onClick={() => setSelectedWatcher(w.id)}
                  onMouseEnter={() => setHovered(true)}
                  onMouseLeave={() => setHovered(false)}
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    position: 'relative',
                    'border-left': `2px solid ${state.selectedWatcher === w.id ? 'var(--accent-cyan)' : 'transparent'}`,
                    'background': state.selectedWatcher === w.id ? 'rgba(0, 229, 255, 0.05)' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      width: '5px',
                      height: '5px',
                      'border-radius': '50%',
                      background: getStatusColor(w),
                      'box-shadow': `0 0 4px ${getStatusColor(w)}`,
                      'flex-shrink': 0,
                    }}
                  />
                  <span style={{ 'font-size': '11px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                    {w.name}
                  </span>
                  <Show when={hovered()}>
                    <div
                      style={{ display: 'flex', gap: '2px' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setSelectedWatcher(w.id);
                          setViewMode('expanded');
                          setExpandedWatcher(w.id);
                        }}
                        title="Expand"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-dim)',
                          width: '16px',
                          height: '16px',
                          display: 'flex',
                          'align-items': 'center',
                          'justify-content': 'center',
                          'font-size': '9px',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-dim)'; }}
                      >
                        ⤢
                      </button>
                      <button
                        onClick={() => setEditingWatcherId(w.id)}
                        title="Edit watcher config"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-dim)',
                          width: '16px',
                          height: '16px',
                          display: 'flex',
                          'align-items': 'center',
                          'justify-content': 'center',
                          'font-size': '9px',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-dim)'; }}
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => {
                          cancelWatcher(w.id);
                          removeWatcher(w.id);
                        }}
                        title="Delete"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-dim)',
                          width: '16px',
                          height: '16px',
                          display: 'flex',
                          'align-items': 'center',
                          'justify-content': 'center',
                          'font-size': '10px',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-red)'; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-dim)'; }}
                      >
                        ✕
                      </button>
                    </div>
                  </Show>
                  <Show when={!hovered()}>
                    <span style={{ 'font-size': '10px', color: 'var(--text-dim)' }}>
                      {w.status === 'loading' ? '...' : timeAgo(w.lastFetch)}
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>

          {/* Add Watcher Button */}
          <div
            onClick={() => setShowAddModal(true)}
            style={{
              padding: '8px 12px',
              margin: '4px 8px',
              border: '1px dashed var(--border)',
              'text-align': 'center',
              'font-size': '10px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              'text-transform': 'uppercase',
              'letter-spacing': '0.05em',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = 'var(--accent-cyan)';
              (e.target as HTMLElement).style.color = 'var(--accent-cyan)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = 'var(--border)';
              (e.target as HTMLElement).style.color = 'var(--text-muted)';
            }}
          >
            + Add Watcher
          </div>
        </div>
      </Show>

      {/* SETTINGS SECTION */}
      <Show when={activeSection() === 'settings'}>
        <div style={{ padding: '12px', 'font-size': '10px' }}>
          <div style={{ color: 'var(--text-muted)', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', 'margin-bottom': '8px' }}>
            Background
          </div>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <For each={bgOptions}>
              {(opt) => (
                <div
                  onClick={() => setBackground(opt.value)}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    color: state.dashboard.background === opt.value ? 'var(--accent-cyan)' : 'var(--text-primary)',
                    border: `1px solid ${state.dashboard.background === opt.value ? 'var(--accent-cyan)' : 'var(--border)'}`,
                    'font-size': '10px',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </div>
              )}
            </For>
          </div>

          <div style={{ color: 'var(--text-muted)', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', margin: '16px 0 8px' }}>
            Filters
          </div>
          <For each={PRESET_FILTERS}>
            {(f) => (
              <div style={{ padding: '4px 0', color: 'var(--text-primary)', 'font-size': '10px' }}>
                {f.name}
                <span style={{ float: 'right', color: 'var(--text-dim)' }}>{f.keywords.length}k</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* ADD WATCHER MODAL */}
      <Show when={showAddModal()}>
        <AddWatcherModal onClose={() => setShowAddModal(false)} />
      </Show>
    </div>
  );
};

// ─── ADD WATCHER MODAL ───
interface ModalProps { onClose: () => void }

const AddWatcherModal: Component<ModalProps> = (props) => {
  const plugins = getAllPlugins();
  const [selectedPlugin, setSelectedPlugin] = createSignal<string | null>(null);
  const [name, setName] = createSignal('');
  const [config, setConfig] = createSignal<Record<string, unknown>>({});
  const [interval, setInterval_] = createSignal<number>(60_000);
  const [scheduleMode, setScheduleMode] = createSignal<'interval' | 'cron'>('interval');
  const [cron, setCron] = createSignal<string>('');

  function handleAdd() {
    const plugin = plugins.find((p) => p.plugin.id === selectedPlugin());
    if (!plugin) return;

    const id = `watcher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxOrder = Math.max(0, ...Object.values(state.watchers).map((w) => w.order ?? 0));
    setWatcher(id, {
      id,
      name: name() || plugin.plugin.name,
      pluginId: plugin.plugin.id,
      status: 'idle',
      config: config(),
      interval: interval(),
      scheduleMode: scheduleMode(),
      cron: scheduleMode() === 'cron' ? cron() : undefined,
      lastFetch: 0,
      events: [],
      retryCount: 0,
      retryDelay: 1000,
      nextRetry: 0,
      order: maxOrder + 1,
    });

    // Schedule polling
    scheduleWatcher(
      id,
      interval(),
      async () => {
        const reg = getAllPlugins().find((p) => p.plugin.id === plugin!.plugin.id);
        if (!reg) return;
        setWatcher(id, { status: 'loading' });
        try {
          console.log(`[poll] Starting fetch for ${id} (${plugin!.plugin.id})`);
          const raw = await reg.plugin.fetch(config());
          console.log(`[poll] Fetch succeeded for ${id}, got:`, JSON.stringify(raw).slice(0, 200));
          const events = reg.plugin.parse(raw, config());
          console.log(`[poll] Parsed ${events.length} events for ${id}`);
          for (const ev of events) {
            ev.watcherId = id;
            pushWatcherEvent(id, ev);
          }
        } catch (err) {
          console.error(`[poll] Fetch failed for ${id}:`, err);
          setWatcher(id, { status: 'error', lastError: String(err) });
        }
      },
      scheduleMode(),
      scheduleMode() === 'cron' ? cron() : undefined
    );

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
          width: '360px',
          padding: '16px',
          'font-size': '11px',
          'clip-path': 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
        }}
      >
        <div style={{ color: 'var(--accent-cyan)', 'font-size': '12px', 'font-weight': 600, 'text-transform': 'uppercase', 'letter-spacing': '0.1em', 'margin-bottom': '12px' }}>
          Add Watcher
        </div>

        {/* Plugin selector */}
        <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>Plugin</label>
        <select
          value={selectedPlugin() ?? ''}
          onChange={(e) => {
            setSelectedPlugin(e.currentTarget.value);
            const p = plugins.find((pl) => pl.plugin.id === e.currentTarget.value);
            if (p) setInterval_(p.plugin.defaultInterval);
          }}
          style={{
            width: '100%',
            padding: '4px 8px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            'font-family': 'var(--font-mono)',
            'font-size': '11px',
            'margin-bottom': '10px',
          }}
        >
          <option value="">Select a plugin...</option>
          <For each={plugins}>
            {(p) => <option value={p.plugin.id}>{p.plugin.name}</option>}
          </For>
        </select>

        {/* Name */}
        <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>Name</label>
        <input
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="My Watcher"
          style={{
            width: '100%',
            padding: '4px 8px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            'font-family': 'var(--font-mono)',
            'font-size': '11px',
            'margin-bottom': '10px',
          }}
        />

        {/* Interval */}
        <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>
          Interval: {Math.round(interval() / 1000)}s
        </label>
        <input
          type="range"
          min="5000"
          max="3600000"
          step="5000"
          value={interval()}
          onInput={(e) => setInterval_(Number(e.currentTarget.value))}
          style={{ width: '100%', 'margin-bottom': '10px' }}
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
            'margin-bottom': '10px',
          }}
        >
          <option value="interval">Interval (every N seconds)</option>
          <option value="cron">Cron schedule</option>
        </select>

        <Show when={scheduleMode() === 'cron'}>
          <label style={{ color: 'var(--text-muted)', display: 'block', 'margin-bottom': '4px' }}>
            Cron expression
          </label>
          <input
            type="text"
            value={cron()}
            onInput={(e) => setCron(e.currentTarget.value)}
            placeholder="0 9 * * *"
            style={{
              width: '100%',
              padding: '4px 8px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              'font-family': 'var(--font-mono)',
              'font-size': '11px',
              'margin-bottom': '10px',
            }}
          />
        </Show>

        {/* Plugin-specific config */}
        <Show when={selectedPlugin()}>
          {(() => {
            const plugin = plugins.find((p) => p.plugin.id === selectedPlugin());
            if (!plugin) return null;
            const schema = plugin.plugin.configSchema as Record<string, { label: string; type: string; placeholder?: string; options?: string[]; default?: unknown; required?: boolean }>;

            return (
              <div style={{ 'margin-bottom': '10px' }}>
                <div style={{ color: 'var(--text-muted)', 'margin-bottom': '6px' }}>Configuration</div>
                <For each={Object.entries(schema)}>
                  {([key, field]) => (
                    <div style={{ 'margin-bottom': '6px' }}>
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
        <div style={{ display: 'flex', gap: '8px', 'margin-top': '12px' }}>
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
            onClick={handleAdd}
            disabled={!selectedPlugin()}
            style={{
              flex: 1,
              padding: '6px',
              background: selectedPlugin() ? 'rgba(0, 229, 255, 0.1)' : 'transparent',
              border: `1px solid ${selectedPlugin() ? 'var(--accent-cyan)' : 'var(--border)'}`,
              color: selectedPlugin() ? 'var(--accent-cyan)' : 'var(--text-dim)',
              'font-family': 'var(--font-mono)',
              'font-size': '10px',
              cursor: selectedPlugin() ? 'pointer' : 'not-allowed',
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
};
