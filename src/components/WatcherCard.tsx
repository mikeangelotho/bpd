import { type Component, Show, createMemo, createSignal } from 'solid-js';
import type { WatcherState } from '../types';
import { state, setSelectedWatcher, removeWatcher, setExpandedWatcher, setViewMode, moveWatcher, getOrderedWatchers, setEditingWatcherId } from '../store/appStore';
import { CardBody } from './CardBody';
import { cancelWatcher, describeCron, refreshWatcher } from '../engine/pluginRegistry';

interface Props {
  watcher: WatcherState;
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
};

export const WatcherCard: Component<Props> = (props) => {
  const w = () => props.watcher;
  const [showActions, setShowActions] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);

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

  const orderedList = createMemo(() => getOrderedWatchers());
  const canMoveUp = createMemo(() => {
    const list = orderedList();
    const idx = list.findIndex((x) => x.id === w().id);
    return idx > 0;
  });
  const canMoveDown = createMemo(() => {
    const list = orderedList();
    const idx = list.findIndex((x) => x.id === w().id);
    return idx >= 0 && idx < list.length - 1;
  });

  function handleDelete() {
    cancelWatcher(w().id);
    removeWatcher(w().id);
  }

  function handleExpand() {
    setViewMode('expanded');
    setExpandedWatcher(w().id);
  }

  function handleMove(direction: 'up' | 'down') {
    moveWatcher(w().id, direction);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshWatcher(w().id);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      class="watcher-card"
      classList={{ selected: state.selectedWatcher === w().id }}
      onClick={() => setSelectedWatcher(state.selectedWatcher === w().id ? null : w().id)}
      onDblClick={handleExpand}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      style={{
        'margin-bottom': '12px',
        background: 'rgba(10, 10, 26, 0.85)',
        border: `1px solid ${state.selectedWatcher === w().id ? 'rgba(0, 229, 255, 0.3)' : 'var(--border)'}`,
        backdropFilter: 'blur(8px)',
        position: 'relative',
        overflow: 'hidden',
        'clip-path': 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
        'max-height': '520px',
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

      {/* Header */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '6px',
          padding: '8px 12px 6px',
          'flex-shrink': 0,
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
        <span
          style={{
            'font-size': '10px',
            color: statusColor(),
            'letter-spacing': '0.05em',
          }}
        >
          ● {statusLabel()}
        </span>

        {/* Refresh button */}
        <button
          onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
          title="Refresh now"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            width: '16px',
            height: '16px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'font-size': '9px',
            cursor: refreshing() ? 'wait' : 'pointer',
            padding: 0,
            'line-height': 1,
            transition: 'border-color 0.15s, color 0.15s',
            opacity: refreshing() ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { if (!refreshing()) { (e.target as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; } }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = 'var(--text-muted)'; }}
        >
          {refreshing() ? (
            <span style={{ display: 'inline-block', width: '8px', height: '8px', border: '1px solid currentColor', 'border-top-color': 'transparent', 'border-radius': '50%', animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <span innerHTML="&#8635;" />
          )}
        </button>

        {/* CRUD buttons (appear on hover) */}
        <Show when={showActions()}>
          <div
            style={{ display: 'flex', gap: '2px', 'margin-left': '2px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Move up */}
            <button
              onClick={() => handleMove('up')}
              title="Move up"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: canMoveUp() ? 'var(--text-muted)' : 'var(--text-dim)',
                width: '16px',
                height: '16px',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'font-size': '8px',
                cursor: canMoveUp() ? 'pointer' : 'not-allowed',
                padding: 0,
                'line-height': 1,
              }}
              onMouseEnter={(e) => { if (canMoveUp()) { (e.target as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; } }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = canMoveUp() ? 'var(--text-muted)' : 'var(--text-dim)'; }}
            >
              ▲
            </button>
            {/* Move down */}
            <button
              onClick={() => handleMove('down')}
              title="Move down"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: canMoveDown() ? 'var(--text-muted)' : 'var(--text-dim)',
                width: '16px',
                height: '16px',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'font-size': '8px',
                cursor: canMoveDown() ? 'pointer' : 'not-allowed',
                padding: 0,
                'line-height': 1,
              }}
              onMouseEnter={(e) => { if (canMoveDown()) { (e.target as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; } }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = canMoveDown() ? 'var(--text-muted)' : 'var(--text-dim)'; }}
            >
              ▼
            </button>
            {/* Expand */}
            <button
              onClick={handleExpand}
              title="View full data"
              style={{
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
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              ⤢
            </button>
            {/* Edit — opens popup */}
            <button
              onClick={(e) => { e.stopPropagation(); setEditingWatcherId(w().id); }}
              title="Edit watcher"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                width: '16px',
                height: '16px',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'font-size': '8px',
                cursor: 'pointer',
                padding: 0,
                'line-height': 1,
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent-cyan)'; (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              ✎
            </button>
            {/* Delete */}
            <button
              onClick={handleDelete}
              title="Delete watcher"
              style={{
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
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent-red)'; (e.target as HTMLElement).style.color = 'var(--accent-red)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              ✕
            </button>
          </div>
        </Show>
      </div>

      {/* Body */}
      <div style={{ flex: 1, 'min-height': 0 }}>
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
    </div>
  );
};
