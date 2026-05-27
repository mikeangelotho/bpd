import { type Component, Show, createMemo, createSignal, onMount, onCleanup } from 'solid-js';
import { state, toggleSidebar, toggleTopbar, setEditingWatcherId, toggleFocusMode } from './store/appStore';
import { Background } from './components/Background';
import { MapBackgroundComponent } from './components/MapBackground';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AlertsPanel } from './components/AlertsPanel';
import { ExpandedView } from './components/ExpandedView';
import { EditWatcherModal } from './components/EditWatcherModal';
import { AIChat } from './components/AIChat';

export const App: Component = () => {
  const [chatOpen, setChatOpen] = createSignal(false);

  const expandedWatcher = createMemo(() => {
    if (state.viewMode !== 'expanded' || !state.expandedWatcher) return null;
    return state.watchers[state.expandedWatcher];
  });

  const editingWatcher = createMemo(() => {
    const id = state.editingWatcherId;
    return id ? state.watchers[id] : null;
  });

  // Escape key toggles focus mode (only when not in a modal/input)
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !state.editingWatcherId && !state.expandedWatcher) {
        toggleFocusMode();
      }
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Background layer (z-index: 0) */}
      <div
        classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
        style={{ position: 'absolute', inset: 0, 'z-index': 0, overflow: 'hidden' }}
      >
        <Background type={state.dashboard.background} />
      </div>

      {/* Live map — ALWAYS visible, even in focus mode */}
      <MapBackgroundComponent />

      {/* Top bar wrapper — animated collapse */}
      <div
        classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
        style={{
          'max-height': state.topbarHidden ? '0px' : 'var(--topbar-height)',
          opacity: state.topbarHidden ? 0 : (state.focusMode ? 0 : 1),
          position: 'relative',
          'z-index': 10,
          transition: state.focusMode
            ? 'max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
            : 'max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <TopBar onToggleChat={() => setChatOpen((v) => !v)} />
      </div>

      {/* Topbar toggle — appears at top-right when hidden */}
      <button
        class="toggle-btn"
        classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
        onClick={toggleTopbar}
        style={{
          position: 'absolute',
          top: state.topbarHidden ? '8px' : 'calc(var(--topbar-height) + 8px)',
          right: '8px',
          width: '24px',
          height: '24px',
          'border-radius': '4px',
          'z-index': 11,
          transition: 'top 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        title={state.topbarHidden ? 'Show topbar' : 'Hide topbar'}
      >
        {state.topbarHidden ? '▾' : '▴'}
      </button>

      {/* Main area */}
      <div
        classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
        style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', 'z-index': 1 }}
      >
        <Show when={state.viewMode !== 'expanded'}>
          {/* Sidebar wrapper — full height */}
          <div
            class="sidebar-transition"
            style={{
              width: state.sidebarCollapsed ? '0px' : 'var(--sidebar-width)',
              height: '100%',
              'flex-shrink': 0,
            }}
          >
            <Sidebar />
          </div>

          {/* Sidebar toggle — appears at left edge when collapsed */}
          <button
            class="toggle-btn"
            classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
            onClick={toggleSidebar}
            style={{
              position: 'absolute',
              left: state.sidebarCollapsed ? '8px' : 'calc(var(--sidebar-width) + 8px)',
              top: '12px',
              width: '24px',
              height: '24px',
              'border-radius': '4px',
              'z-index': 6,
              transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            title={state.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {state.sidebarCollapsed ? '▸' : '◂'}
          </button>

          {/* Content — routed by store state */}
          <Show
            when={state.currentView === 'dashboard'}
            fallback={<AlertsPanel />}
          >
            <Dashboard />
          </Show>
        </Show>
      </div>

      {/* Expanded view overlay */}
      <Show when={expandedWatcher()}>
        {(watcher) => (
          <div
            classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
            style={{ position: 'absolute', inset: 0, 'z-index': 100 }}
          >
            <ExpandedView watcher={watcher()} />
          </div>
        )}
      </Show>

      {/* Edit watcher popup — overlays everything */}
      <Show when={editingWatcher()}>
        {(w) => (
          <div
            classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
            style={{ position: 'fixed', inset: 0, 'z-index': 200 }}
          >
            <EditWatcherModal
              watcher={w()}
              onClose={() => setEditingWatcherId(null)}
            />
          </div>
        )}
      </Show>

      {/* AI Chat overlay */}
      <Show when={chatOpen()}>
        <div
          classList={{ 'focus-overlay': true, 'focus-hidden': state.focusMode }}
          style={{ position: 'fixed', inset: 0, 'z-index': 150 }}
        >
          <AIChat open={true} onClose={() => setChatOpen(false)} />
        </div>
      </Show>

      {/* Focus exit button — ALWAYS visible when in focus mode */}
      <Show when={state.focusMode}>
        <button
          onClick={toggleFocusMode}
          style={{
            position: 'fixed',
            top: '12px',
            right: '12px',
            'z-index': 9999,
            background: 'rgba(10, 10, 26, 0.85)',
            'backdrop-filter': 'blur(8px)',
            border: '1px solid var(--accent-green)',
            color: 'var(--accent-green)',
            padding: '6px 16px',
            'font-family': 'var(--font-mono)',
            'font-size': '10px',
            'font-weight': 600,
            cursor: 'pointer',
            'text-transform': 'uppercase',
            'letter-spacing': '0.1em',
            'border-radius': '4px',
            transition: 'all 0.2s',
            'box-shadow': 'var(--glow-green)',
          }}
          title="Exit focus mode (or press Escape)"
        >
          ← EXIT
        </button>
      </Show>
    </div>
  );
};
