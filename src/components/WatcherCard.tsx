import { type Component, Show, createMemo, createSignal } from 'solid-js';
import type { WatcherState } from '../types';
import {
  state,
  setSelectedWatcher,
  removeWatcher,
  setEditingWatcherId,
  minimizeWindow,
  toggleMaximize,
} from '../store/appStore';
import { CardBody } from './CardBody';
import { cancelWatcher, describeCron, refreshWatcher } from '../engine/pluginRegistry';

interface Props {
  watcher: WatcherState;
  /** Begin dragging the window (pointer down on the title bar). */
  onDragStart?: (e: PointerEvent) => void;
  /** Begin resizing the window (pointer down on the resize handle). */
  onResizeStart?: (e: PointerEvent) => void;
}

const ICONS: Record<string, string> = {
  'rss-feed': '◈',
  'ticker': '▸',
  'url-scraper': '⬡',
  'demo': '◎',
  'trending': '▲',
  'google-trends': '🔥',
  'adsb-exchange': '✈',
  'open-meteo': '🌡',
  'youtube': '▶',
};

export const WatcherCard: Component<Props> = (props) => {
  const w = () => props.watcher;
  const [showActions, setShowActions] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);

  const isMaximized = () => state.maximizedWatcher === w().id;

  const statusLabel = createMemo(() => {
    const s = w().status;
    if (s === 'loading') return 'SYNC';
    if (s === 'error') return 'ERR';
    if (s === 'stale') return 'STALE';
    return 'LIVE';
  });

  const statusColor = createMemo(() => {
    const s = w().status;
    if (s === 'error') return 'var(--accent-red)';
    if (s === 'stale' || s === 'loading') return 'var(--accent-amber)';
    return 'var(--accent-green)';
  });

  const timeAgo = (ts: number): string => {
    if (!ts) return 'never';
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h`;
  };

  const scheduleDescription = createMemo(() => {
    if (w().scheduleMode === 'cron' && w().cron) {
      return describeCron(w().cron!);
    }
    const sec = w().interval / 1000;
    if (sec < 60) return `Every ${Math.round(sec)}s`;
    if (sec < 3600) return `Every ${Math.round(sec / 60)}m`;
    return `Every ${Math.round(sec / 3600)}h`;
  });

  function handleDelete() {
    cancelWatcher(w().id);
    removeWatcher(w().id);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshWatcher(w().id);
    } finally {
      setRefreshing(false);
    }
  }

  function handleTitlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    setSelectedWatcher(w().id);
    if (!isMaximized()) props.onDragStart?.(e);
  }

  const iconBtn: Record<string, string | number> = {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    width: '16px',
    height: '16px',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'font-size': '9px',
    cursor: 'pointer',
    padding: 0,
    'line-height': 1,
  };

  return (
    <div
      class="watcher-card"
      classList={{ selected: state.selectedWatcher === w().id }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      style={{
        height: '100%',
        background: 'rgba(10, 10, 26, 0.85)',
        border: `1px solid ${state.selectedWatcher === w().id ? 'rgba(0, 229, 255, 0.3)' : 'var(--border)'}`,
        'backdrop-filter': 'blur(8px)',
        position: 'relative',
        overflow: 'hidden',
        'clip-path': 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))',
        transition: 'border-color 0.2s',
        display: 'flex',
        'flex-direction': 'column',
      }}
    >
      {/* Top accent line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: `linear-gradient(90deg, ${statusColor()}, transparent 60%)`,
          opacity: 0.5,
        }}
      />

      {/* Title bar — drag handle */}
      <div
        onPointerDown={handleTitlePointerDown}
        onDblClick={() => toggleMaximize(w().id)}
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '6px',
          padding: '8px 12px 6px',
          'flex-shrink': 0,
          cursor: isMaximized() ? 'default' : 'grab',
          'touch-action': 'none',
          'user-select': 'none',
        }}
      >
        <div
          style={{
            width: '16px',
            height: '16px',
            border: '1px solid var(--accent-cyan)',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'font-size': '8px',
            color: 'var(--accent-cyan)',
            opacity: 0.7,
            'flex-shrink': 0,
          }}
        >
          {ICONS[w().pluginId] || '·'}
        </div>
        <span
          style={{
            'font-size': '11px',
            'text-transform': 'uppercase',
            'letter-spacing': '0.1em',
            color: 'var(--text-muted)',
            flex: 1,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          {w().name}
        </span>
        <span style={{ 'font-size': '10px', color: statusColor(), 'letter-spacing': '0.05em', 'flex-shrink': 0 }}>
          ● {statusLabel()}
        </span>

        {/* Window controls — stop pointer so clicks don't start a drag */}
        <div
          style={{ display: 'flex', gap: '2px', 'margin-left': '2px', 'flex-shrink': 0 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Refresh */}
          <button
            onClick={handleRefresh}
            title="Refresh now"
            style={{ ...iconBtn, cursor: refreshing() ? 'wait' : 'pointer', opacity: refreshing() ? 0.5 : 1 }}
            onMouseEnter={(e) => { if (!refreshing()) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-cyan)'; } }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
          >
            {refreshing() ? (
              <span style={{ display: 'inline-block', width: '8px', height: '8px', border: '1px solid currentColor', 'border-top-color': 'transparent', 'border-radius': '50%', animation: 'spin 0.8s linear infinite' }} />
            ) : (
              <span innerHTML="&#8635;" />
            )}
          </button>

          <Show when={showActions()}>
            {/* Minimize */}
            <button
              onClick={() => minimizeWindow(w().id)}
              title="Minimize to sidebar"
              style={iconBtn}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-cyan)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              ▁
            </button>
            {/* Maximize / restore */}
            <button
              onClick={() => toggleMaximize(w().id)}
              title={isMaximized() ? 'Restore' : 'Maximize'}
              style={iconBtn}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-cyan)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              {isMaximized() ? '🗗' : '⛶'}
            </button>
            {/* Edit */}
            <button
              onClick={() => setEditingWatcherId(w().id)}
              title="Edit watcher"
              style={iconBtn}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-cyan)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              ✎
            </button>
            {/* Delete */}
            <button
              onClick={handleDelete}
              title="Delete watcher"
              style={iconBtn}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-red)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-red)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              ✕
            </button>
          </Show>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, 'min-height': 0, 'overflow-y': 'auto' }}>
        <Show when={w().status === 'error'}>
          <div style={{ padding: '8px 12px 10px' }}>
            <div style={{ color: 'var(--accent-red)', 'font-size': '10px' }}>
              ⚠ {w().lastError ?? 'Unknown error'}
            </div>
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '6px' }}>
              <span>{w().events.length} events</span>
              <span>updated {timeAgo(w().lastFetch)} ago</span>
            </div>
          </div>
        </Show>

        <Show when={w().status !== 'error'}>
          <CardBody watcher={w()} compact />
        </Show>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', 'justify-content': 'space-between', padding: '4px 12px 6px', 'font-size': '9px', color: 'var(--text-dim)', 'border-top': '1px solid var(--border)', 'flex-shrink': 0 }}>
        <span>{scheduleDescription()}</span>
        <span>{timeAgo(w().lastFetch)} ago</span>
      </div>

      {/* Resize handle (bottom-right) — hidden while maximized */}
      <Show when={!isMaximized()}>
        <div
          onPointerDown={(e) => props.onResizeStart?.(e)}
          title="Resize"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: '16px',
            height: '16px',
            cursor: 'nwse-resize',
            'touch-action': 'none',
            'z-index': 3,
            background: 'linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--accent-cyan) 100%)',
            opacity: showActions() ? 0.9 : 0.4,
          }}
        />
      </Show>
    </div>
  );
};
