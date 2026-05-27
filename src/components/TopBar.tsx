import { type Component, For, Show, createSignal } from 'solid-js';
import { state, setCurrentView, toggleFocusMode } from '../store/appStore';
import { PRESET_FILTERS, setActiveFilter } from '../store/appStore';
import type { View } from '../types';

interface TopBarProps {
  onToggleChat: () => void;
}

export const TopBar: Component<TopBarProps> = (props) => {
  const [showFilterMenu, setShowFilterMenu] = createSignal(false);
  const tabs: View[] = ['dashboard', 'alerts', 'plugins', 'config'];

  const pendingCount = () => state.alerts.filter((a) => !a.acknowledged).length;

  return (
    <div
      style={{
        position: 'relative',
        'z-index': 10,
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        padding: '0 20px',
        height: 'var(--topbar-height)',
        background: 'var(--bg-panel)',
        'border-bottom': '1px solid var(--border)',
        'flex-shrink': 0,
      }}
    >
      {/* Brand */}
      <div
        style={{
          'font-size': '16px',
          'font-weight': 700,
          'letter-spacing': '0.2em',
          color: 'var(--accent-cyan)',
          'text-shadow': 'var(--glow-cyan)',
          'margin-right': '24px',
          cursor: 'default',
        }}
      >
        BPD
      </div>

      {/* Nav tabs */}
      <For each={tabs}>
        {(tab) => (
          <div
            class="nav-tab"
            classList={{ active: state.currentView === tab }}
            onClick={() => setCurrentView(tab)}
            style={{
              'font-size': '11px',
              color: tab === 'alerts' && pendingCount() > 0 ? 'var(--accent-amber)' : 'var(--text-muted)',
              padding: '4px 0',
              'border-bottom': `1px solid ${state.currentView === tab ? 'var(--accent-cyan)' : 'transparent'}`,
              cursor: 'pointer',
              'transition': 'all 0.2s',
              'text-transform': 'uppercase',
              'letter-spacing': '0.06em',
              position: 'relative',
            }}
          >
            {tab}
            <Show when={tab === 'alerts' && pendingCount() > 0}>
              <span
                style={{
                  display: 'inline-block',
                  'margin-left': '4px',
                  padding: '0 5px',
                  'font-size': '10px',
                  background: 'rgba(255, 171, 64, 0.2)',
                  color: 'var(--accent-amber)',
                  'border-radius': '2px',
                }}
              >
                {pendingCount()}
              </span>
            </Show>
          </div>
        )}
      </For>

      {/* Filter dropdown */}
      <div style={{ 'margin-left': 'auto', position: 'relative' }}>
        <button
          onClick={() => setShowFilterMenu((v) => !v)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: state.activeFilter ? 'var(--accent-cyan)' : 'var(--text-muted)',
            padding: '3px 10px',
            'font-family': 'var(--font-mono)',
            'font-size': '10px',
            cursor: 'pointer',
            'text-transform': 'uppercase',
            'letter-spacing': '0.05em',
          }}
        >
          {state.activeFilter ? `Filter: ${state.activeFilter}` : 'All Signals ▾'}
        </button>

        <Show when={showFilterMenu()}>
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 0,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              'min-width': '200px',
              'z-index': 100,
            }}
          >
            <div
              class="filter-option"
              onClick={() => { setActiveFilter(null); setShowFilterMenu(false); }}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                color: !state.activeFilter ? 'var(--accent-cyan)' : 'var(--text-primary)',
                'font-size': '11px',
              }}
            >
              All Signals
            </div>
            <For each={PRESET_FILTERS}>
              {(filter) => (
                <div
                  class="filter-option"
                  onClick={() => { setActiveFilter(filter.id); setShowFilterMenu(false); }}
                  style={{
                    padding: '6px 12px',
                    cursor: 'pointer',
                    color: state.activeFilter === filter.id ? 'var(--accent-cyan)' : 'var(--text-primary)',
                    'font-size': '11px',
                    'border-top': '1px solid var(--border)',
                  }}
                >
                  {filter.name}
                  <span style={{ float: 'right', color: 'var(--text-dim)', 'font-size': '10px' }}>
                    {filter.keywords.length} keywords
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Status indicators */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          'font-size': '10px',
          'margin-left': '16px',
        }}
      >
        <span style={{ color: 'var(--text-dim)' }}>
          WATCHERS <span style={{ color: 'var(--accent-green)' }}>{Object.keys(state.watchers).length}</span>
        </span>
        <span style={{ color: 'var(--text-dim)' }}>
          ALERTS <span style={{ color: pendingCount() > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{pendingCount()}</span>
        </span>
      </div>

      {/* AI Chat button */}
      <button
        onClick={props.onToggleChat}
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '6px',
          background: 'transparent',
          border: '1px solid var(--accent-cyan)',
          color: 'var(--accent-cyan)',
          padding: '3px 10px',
          'font-family': 'var(--font-mono)',
          'font-size': '10px',
          cursor: 'pointer',
          'text-transform': 'uppercase',
          'letter-spacing': '0.05em',
          'clip-path': 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
          'margin-left': '12px',
          transition: 'all 0.15s',
        }}
        title="Open AI Chat"
      >
        <span style={{ 'font-size': '12px' }}>◆</span>
        AI
      </button>

      {/* Enter focus mode */}
      <button
        onClick={toggleFocusMode}
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '6px',
          background: 'transparent',
          border: '1px solid var(--accent-magenta)',
          color: 'var(--accent-magenta)',
          padding: '3px 10px',
          'font-family': 'var(--font-mono)',
          'font-size': '10px',
          cursor: 'pointer',
          'text-transform': 'uppercase',
          'letter-spacing': '0.05em',
          'clip-path': 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
          'margin-left': '8px',
          transition: 'all 0.15s',
        }}
        title="Focus mode — hide all overlays"
      >
        <span style={{ 'font-size': '12px' }}>⊡</span>
        FOCUS
      </button>
    </div>
  );
};
