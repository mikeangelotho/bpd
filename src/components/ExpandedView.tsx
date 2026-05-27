import { type Component, For, Show, createMemo } from 'solid-js';
import type { WatcherState, WatcherEvent } from '../types';
import { setExpandedWatcher } from '../store/appStore';

interface Props {
  watcher: WatcherState;
}

// ─── EXPANDED VIEW DISPATCHER ───
export const ExpandedView: Component<Props> = (props) => {
  const pluginId = () => props.watcher.pluginId;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        'z-index': 100,
        background: 'var(--bg-primary)',
        display: 'flex',
        'flex-direction': 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '12px',
          padding: '12px 20px',
          background: 'var(--bg-panel)',
          'border-bottom': '1px solid var(--border)',
          'flex-shrink': 0,
        }}
      >
        <button
          onClick={() => setExpandedWatcher(null)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            padding: '4px 10px',
            'font-family': 'var(--font-mono)',
            'font-size': '11px',
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
        <span
          style={{
            'font-size': '14px',
            'font-weight': 600,
            'text-transform': 'uppercase',
            'letter-spacing': '0.1em',
            color: 'var(--accent-cyan)',
          }}
        >
          {props.watcher.name}
        </span>
        <span
          style={{
            'font-size': '10px',
            color: 'var(--text-muted)',
            'margin-left': 'auto',
          }}
        >
          {props.watcher.events.length} events · Plugin: {props.watcher.pluginId}
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, 'overflow-y': 'auto', padding: '16px 20px' }}>
        <Show when={pluginId() === 'ticker'} fallback={<GenericExpanded {...props} />}>
          <TickerExpanded {...props} />
        </Show>
        <Show when={pluginId() === 'rss-feed'}>
          <NewsExpanded {...props} />
        </Show>
        <Show when={pluginId() === 'news-api'}>
          <NewsExpanded {...props} />
        </Show>
        <Show when={pluginId() === 'url-scraper'}>
          <ScraperExpanded {...props} />
        </Show>
        <Show when={pluginId() === 'trending'}>
          <TrendingExpanded {...props} />
        </Show>
        <Show when={pluginId() === 'google-trends'}>
          <GoogleTrendsExpanded {...props} />
        </Show>
      </div>
    </div>
  );
};

// ─── TICKER EXPANDED ───
const TickerExpanded: Component<Props> = (props) => {
  const w = () => props.watcher;

  const allTicks = createMemo(() => w().events.filter((ev) => ev.payload.symbol));

  const latestBySymbol = createMemo(() => {
    const map = new Map<string, WatcherEvent>();
    for (const ev of w().events) {
      const sym = ev.payload.symbol as string | undefined;
      if (sym) map.set(sym, ev);
    }
    return Array.from(map.values());
  });

  const priceHistory = createMemo(() => {
    const history = new Map<string, Array<{ time: number; price: number; change: string }>>();
    for (const ev of w().events) {
      const sym = ev.payload.symbol as string | undefined;
      const priceStr = ev.payload.price as string | undefined;
      const change = ev.payload.change as string | undefined;
      if (sym && priceStr) {
        const price = parseFloat(priceStr.replace(/[$,]/g, ''));
        if (!isNaN(price)) {
          if (!history.has(sym)) history.set(sym, []);
          history.get(sym)!.push({ time: ev.timestamp, price, change: change ?? '' });
        }
      }
    }
    return history;
  });

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: '12px', 'margin-bottom': '16px', 'flex-wrap': 'wrap' }}>
        <For each={latestBySymbol()}>
          {(ev) => {
            const sym = ev.payload.symbol as string;
            const price = ev.payload.price as string;
            const change = ev.payload.change as string;
            const history = priceHistory().get(sym) ?? [];
            const first = history[0]?.price;
            const last = history[history.length - 1]?.price;
            const range = first && last ? `${((last - first) / first * 100).toFixed(2)}%` : '—';

            return (
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  padding: '12px 16px',
                  'min-width': '200px',
                  'clip-path': 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
                }}
              >
                <div style={{ 'font-size': '18px', 'font-weight': 700, color: 'var(--text-primary)' }}>
                  {sym}
                </div>
                <div style={{ 'font-size': '22px', 'font-weight': 600, color: 'var(--text-primary)', margin: '4px 0' }}>
                  {price}
                </div>
                <div style={{ 'font-size': '12px', color: change.includes('+') ? 'var(--accent-green)' : change.includes('-') ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                  {change} {history.length > 1 ? `· Session: ${range}` : ''}
                </div>
                <Show when={ev.payload.marketCap}>
                  <div style={{ 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '4px' }}>
                    MCap: {String(ev.payload.marketCap)}
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>

      {/* Full tick history */}
      <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', color: 'var(--text-muted)', 'margin-bottom': '8px' }}>
        Tick History ({allTicks().length} records)
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', 'font-family': 'var(--font-mono)' }}>
        <div style={{ display: 'flex', padding: '6px 10px', 'border-bottom': '1px solid var(--border)', 'font-size': '10px', color: 'var(--text-dim)', 'text-transform': 'uppercase' }}>
          <span style={{ width: '60px' }}>Time</span>
          <span style={{ width: '60px' }}>Symbol</span>
          <span style={{ flex: 1 }}>Price</span>
          <span style={{ width: '80px', 'text-align': 'right' }}>Change</span>
        </div>
        <For each={allTicks().reverse()}>
          {(ev) => {
            const time = new Date(ev.timestamp);
            const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
            const change = ev.payload.change as string;
            return (
              <div style={{ display: 'flex', padding: '4px 10px', 'font-size': '10px', 'border-bottom': '1px solid rgba(26,26,46,0.3)' }}>
                <span style={{ width: '60px', color: 'var(--text-dim)' }}>{timeStr}</span>
                <span style={{ width: '60px', color: 'var(--text-primary)', 'font-weight': 600 }}>{String(ev.payload.symbol)}</span>
                <span style={{ flex: 1, color: 'var(--text-primary)' }}>{String(ev.payload.price)}</span>
                <span
                  style={{
                    width: '80px',
                    'text-align': 'right',
                    color: change?.includes('+') ? 'var(--accent-green)' : change?.includes('-') ? 'var(--accent-red)' : 'var(--text-muted)',
                  }}
                >
                  {change ?? '—'}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

// ─── NEWS EXPANDED — Full article cards with images ───
const NewsExpanded: Component<Props> = (props) => {
  const w = () => props.watcher;

  const articles = createMemo(() => {
    const seen = new Set<string>();
    return w().events
      .filter((ev) => ev.payload.title)
      .filter((ev) => {
        const title = ev.payload.title as string;
        if (seen.has(title)) return false;
        seen.add(title);
        return true;
      })
      .reverse();
  });

  function formatDate(ts: number): string {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  return (
    <div>
      <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', color: 'var(--text-muted)', 'margin-bottom': '8px' }}>
        Articles ({articles().length} unique)
      </div>

      <For each={articles()}>
        {(ev) => {
          const title = ev.payload.title as string;
          const link = ev.payload.link as string | undefined;
          const image = ev.payload.image as string | undefined;
          const desc = ev.payload.description as string | undefined;
          const timeStr = formatDate(ev.timestamp);

          return (
            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                'margin-bottom': '10px',
                'clip-path': 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
                overflow: 'hidden',
              }}
            >
              {/* Image hero */}
              <Show when={image}>
                <div
                  style={{
                    width: '100%',
                    height: '140px',
                    'background-color': 'var(--bg-panel)',
                    'background-image': `url(${image})`,
                    'background-size': 'cover',
                    'background-position': 'center',
                    'border-bottom': '1px solid var(--border)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Cyberpunk overlay layers */}
                  <div
                    style={{
                      position: 'absolute', inset: 0,
                      background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.03) 2px, rgba(0,229,255,0.03) 4px)',
                      'pointer-events': 'none',
                      mixBlendMode: 'overlay',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute', inset: 0,
                      background: 'radial-gradient(ellipse at center, transparent 50%, rgba(180,0,255,0.08) 100%)',
                      'pointer-events': 'none',
                    }}
                  />
                  {/* Color filter layer */}
                  <div
                    style={{
                      position: 'absolute', inset: 0,
                      backdropFilter: 'saturate(1.15) contrast(1.08) brightness(0.95)',
                      'background-color': 'rgba(0,229,255,0.04)',
                      mixBlendMode: 'color-dodge',
                      'pointer-events': 'none',
                    }}
                  />
                </div>
              </Show>

              {/* Content */}
              <div style={{ padding: '12px 16px' }}>
                {/* Title + link */}
                <div style={{ 'font-size': '13px', 'font-weight': 600, color: 'var(--text-primary)', 'line-height': '1.4', 'margin-bottom': '6px' }}>
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'inherit', 'text-decoration': 'none' }}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-primary)'; }}
                    >
                      {title}
                    </a>
                  ) : (
                    title
                  )}
                </div>

                {/* Description */}
                <Show when={desc && desc.length > 10}>
                  <div
                    style={{
                      'font-size': '10px',
                      color: 'var(--text-muted)',
                      'line-height': '1.5',
                      'margin-bottom': '8px',
                      'max-height': '100px',
                      'overflow-y': 'auto',
                    }}
                  >
                    {(desc as string).slice(0, 800)}
                  </div>
                </Show>

                {/* Footer */}
                <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'font-size': '9px', color: 'var(--text-dim)' }}>
                  <span>{timeStr}</span>
                  <Show when={link}>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent-cyan)', 'text-decoration': 'none' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Read article →
                    </a>
                  </Show>
                </div>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
};

// ─── SCRAPER EXPANDED ───
const ScraperExpanded: Component<Props> = (props) => {
  const w = () => props.watcher;

  const changes = createMemo(() => w().events.filter((ev) => ev.payload.changed === true));
  const latestContent = createMemo(() => {
    const events = w().events.filter((ev) => ev.payload.contentPreview);
    return events[events.length - 1];
  });

  return (
    <div>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: '12px', 'margin-bottom': '16px' }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '12px 16px', flex: 1 }}>
          <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', color: 'var(--text-dim)' }}>Content Size</div>
          <div style={{ 'font-size': '18px', 'font-weight': 600, color: 'var(--text-primary)' }}>
            {latestContent() ? (latestContent()!.payload.contentLength as number).toLocaleString() : '0'}
          </div>
          <div style={{ 'font-size': '10px', color: 'var(--text-muted)' }}>characters</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '12px 16px', flex: 1 }}>
          <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', color: 'var(--text-dim)' }}>Changes Detected</div>
          <div style={{ 'font-size': '18px', 'font-weight': 600, color: changes().length > 0 ? 'var(--accent-amber)' : 'var(--accent-green)' }}>
            {changes().length}
          </div>
          <div style={{ 'font-size': '10px', color: 'var(--text-muted)' }}>
            {changes().length > 0 ? 'last: ' + new Date(changes()[changes().length - 1].timestamp).toLocaleTimeString() : 'none'}
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '12px 16px', flex: 1 }}>
          <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', color: 'var(--text-dim)' }}>Total Scrapes</div>
          <div style={{ 'font-size': '18px', 'font-weight': 600, color: 'var(--text-primary)' }}>
            {w().events.length}
          </div>
        </div>
      </div>

      {/* Full content preview */}
      <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', color: 'var(--text-muted)', 'margin-bottom': '8px' }}>
        Latest Content
      </div>
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          padding: '16px',
          'font-size': '11px',
          'line-height': '1.6',
          color: 'var(--text-primary)',
          'white-space': 'pre-wrap',
          'word-break': 'break-word',
          'max-height': '400px',
          'overflow-y': 'auto',
        }}
      >
        {latestContent() ? (latestContent()!.payload.contentPreview as string) : 'No content captured yet.'}
      </div>
    </div>
  );
};

// ─── GENERIC EXPANDED ───
const GenericExpanded: Component<Props> = (props) => {
  const w = () => props.watcher;

  return (
    <div>
      <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', color: 'var(--text-muted)', 'margin-bottom': '8px' }}>
        All Events ({w().events.length})
      </div>

      <For each={w().events.slice().reverse()}>
        {(ev) => (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              padding: '10px 14px',
              'margin-bottom': '6px',
            }}
          >
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'margin-bottom': '4px' }}>
              <span style={{ 'font-size': '10px', color: 'var(--text-dim)' }}>
                {new Date(ev.timestamp).toLocaleTimeString()}
              </span>
              <span style={{ 'font-size': '10px', color: ev.severity === 'warn' ? 'var(--accent-amber)' : ev.severity === 'error' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                {ev.type} · {ev.severity}
              </span>
            </div>
            <For each={Object.entries(ev.payload).filter(([k]) => k !== 'source' && k !== 'type')}>
              {([key, val]) => (
                <div style={{ display: 'flex', gap: '8px', 'font-size': '10px', 'margin-bottom': '2px' }}>
                  <span style={{ color: 'var(--text-muted)', 'min-width': '100px' }}>{key}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{String(val).slice(0, 200)}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
};

// ─── TRENDING EXPANDED — Full list with thumbnails ───
const TrendingExpanded: Component<Props> = (props) => {
  const w = () => props.watcher;

  const trendingItems = createMemo(() => {
    const seen = new Set<string>();
    return w().events
      .filter((ev) => ev.payload.title)
      .filter((ev) => {
        const title = ev.payload.title as string;
        if (seen.has(title)) return false;
        seen.add(title);
        return true;
      });
  });

  function timeAgo(minutes: number): string {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }

  function velocityColor(velocity: number): string {
    if (velocity > 50) return 'var(--accent-magenta)';
    if (velocity > 20) return 'var(--accent-amber)';
    return 'var(--accent-cyan)';
  }

  return (
    <div>
      <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', color: 'var(--text-muted)', 'margin-bottom': '8px' }}>
        Trending ({trendingItems().length} items)
      </div>

      <For each={trendingItems()}>
        {(ev, idx) => {
          const title = ev.payload.title as string;
          const link = ev.payload.link as string;
          const source = ev.payload.source as string;
          const velocity = (ev.payload.velocity as number) || 0;
          const comments = (ev.payload.comments as number) || 0;
          const ageMin = (ev.payload.ageMinutes as number) || 0;
          const score = (ev.payload.score as number) || 0;
          const thumbnail = ev.payload.thumbnail as string | undefined;
          const flair = ev.payload.flair as string | undefined;
          const rank = idx() + 1;

          return (
            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                'margin-bottom': '8px',
                'clip-path': 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
                overflow: 'hidden',
              }}
            >
              {/* Thumbnail + content row */}
              <div style={{ display: 'flex', gap: '0' }}>
                {/* Thumbnail */}
                <Show when={thumbnail}>
                  <div
                    style={{
                      width: '80px',
                      'min-height': '60px',
                      'background-image': `url(${thumbnail})`,
                      'background-size': 'cover',
                      'background-position': 'center',
                      'background-color': 'var(--bg-panel)',
                      'flex-shrink': 0,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Cyberpunk overlay */}
                    <div
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.03) 2px, rgba(0,229,255,0.03) 4px)',
                        'pointer-events': 'none',
                        mixBlendMode: 'overlay',
                      }}
                    />
                  </div>
                </Show>

                {/* Content */}
                <div style={{ padding: '10px 14px', flex: 1, 'min-width': 0 }}>
                  {/* Rank + Title */}
                  <div style={{ display: 'flex', gap: '8px', 'align-items': 'flex-start', 'margin-bottom': '4px' }}>
                    <div
                      style={{
                        'flex-shrink': 0,
                        width: '22px',
                        height: '22px',
                        display: 'flex',
                        'align-items': 'center',
                        'justify-content': 'center',
                        'font-size': '11px',
                        'font-weight': 700,
                        'font-family': 'JetBrains Mono, monospace',
                        color: velocityColor(velocity),
                        background: 'rgba(0,0,0,0.4)',
                        border: `1px solid ${velocityColor(velocity)}`,
                        'clip-path': 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
                      }}
                    >
                      {rank}
                    </div>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        'font-size': '12px',
                        'font-weight': 600,
                        color: 'var(--text-primary)',
                        'line-height': '1.35',
                        'text-decoration': 'none',
                      }}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-primary)'; }}
                    >
                      {title}
                    </a>
                  </div>

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-left': '30px', 'flex-wrap': 'wrap' }}>
                    <span
                      style={{
                        'font-size': '9px',
                        'font-family': 'JetBrains Mono, monospace',
                        color: source === 'hacker-news' ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                        background: source === 'hacker-news' ? 'rgba(255,167,38,0.1)' : 'rgba(0,229,255,0.08)',
                        border: `1px solid ${source === 'hacker-news' ? 'rgba(255,167,38,0.25)' : 'rgba(0,229,255,0.15)'}`,
                        padding: '1px 5px',
                        'border-radius': '2px',
                        'text-transform': 'uppercase',
                        'letter-spacing': '0.05em',
                      }}
                    >
                      {source}
                    </span>
                    {flair && (
                      <span style={{ 'font-size': '9px', color: 'var(--text-muted)', 'font-family': 'JetBrains Mono, monospace' }}>
                        {flair}
                      </span>
                    )}
                    <span style={{ 'font-size': '9px', color: 'var(--text-dim)', 'font-family': 'JetBrains Mono, monospace' }}>
                      ▲{score} · 💬{comments} · {timeAgo(ageMin)}
                    </span>
                    <span style={{ 'font-size': '9px', color: velocityColor(velocity), 'font-family': 'JetBrains Mono, monospace' }}>
                      {velocity.toFixed(1)} ↑/hr
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
};

// ─── GOOGLE TRENDS EXPANDED — Full list with thumbnails ───
const GoogleTrendsExpanded: Component<Props> = (props) => {
  const w = () => props.watcher;

  const trendItems = createMemo(() => {
    const seen = new Set<string>();
    return w().events
      .filter((ev) => ev.payload.title)
      .filter((ev) => {
        const title = ev.payload.title as string;
        if (seen.has(title)) return false;
        seen.add(title);
        return true;
      });
  });

  function trafficColor(traffic: string): string {
    const n = parseInt(traffic, 10) || 0;
    if (n > 1000) return 'var(--accent-magenta)';
    if (n > 500) return 'var(--accent-amber)';
    return 'var(--accent-cyan)';
  }

  return (
    <div>
      <div style={{ 'font-size': '10px', 'text-transform': 'uppercase', 'letter-spacing': '0.1em', color: 'var(--text-muted)', 'margin-bottom': '8px' }}>
        Google Trends ({trendItems().length} topics)
      </div>

      <For each={trendItems()}>
        {(ev, idx) => {
          const title = ev.payload.title as string;
          const link = ev.payload.link as string;
          const traffic = ev.payload.traffic as string;
          const newsCount = ev.payload.newsCount as number;
          const thumbnail = ev.payload.thumbnail as string | undefined;
          const pubDate = ev.payload.pubDate as string | undefined;
          const rank = idx() + 1;

          return (
            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                'margin-bottom': '8px',
                'clip-path': 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', gap: '0' }}>
                {/* Thumbnail */}
                <Show when={thumbnail}>
                  <div
                    style={{
                      width: '80px',
                      'min-height': '60px',
                      'background-image': `url(${thumbnail})`,
                      'background-size': 'cover',
                      'background-position': 'center',
                      'background-color': 'var(--bg-panel)',
                      'flex-shrink': 0,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.03) 2px, rgba(0,229,255,0.03) 4px)',
                        'pointer-events': 'none',
                        mixBlendMode: 'overlay',
                      }}
                    />
                  </div>
                </Show>

                {/* Content */}
                <div style={{ padding: '10px 14px', flex: 1, 'min-width': 0 }}>
                  <div style={{ display: 'flex', gap: '8px', 'align-items': 'flex-start', 'margin-bottom': '4px' }}>
                    <div
                      style={{
                        'flex-shrink': 0,
                        width: '22px',
                        height: '22px',
                        display: 'flex',
                        'align-items': 'center',
                        'justify-content': 'center',
                        'font-size': '11px',
                        'font-weight': 700,
                        'font-family': 'JetBrains Mono, monospace',
                        color: trafficColor(traffic),
                        background: 'rgba(0,0,0,0.4)',
                        border: `1px solid ${trafficColor(traffic)}`,
                        'clip-path': 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
                      }}
                    >
                      {rank}
                    </div>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        'font-size': '12px',
                        'font-weight': 600,
                        color: 'var(--text-primary)',
                        'line-height': '1.35',
                        'text-decoration': 'none',
                      }}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-primary)'; }}
                    >
                      {title}
                    </a>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-left': '30px', 'flex-wrap': 'wrap' }}>
                    <span
                      style={{
                        'font-size': '9px',
                        'font-family': 'JetBrains Mono, monospace',
                        color: 'var(--accent-amber)',
                        background: 'rgba(255,167,38,0.1)',
                        border: '1px solid rgba(255,167,38,0.25)',
                        padding: '1px 5px',
                        'border-radius': '2px',
                        'text-transform': 'uppercase',
                        'letter-spacing': '0.05em',
                      }}
                    >
                      🔥 trends
                    </span>
                    <span style={{ 'font-size': '9px', color: trafficColor(traffic), 'font-family': 'JetBrains Mono, monospace' }}>
                      ▲{traffic}
                    </span>
                    <span style={{ 'font-size': '9px', color: 'var(--text-dim)', 'font-family': 'JetBrains Mono, monospace' }}>
                      📰{newsCount || 0} related
                    </span>
                    {pubDate && (
                      <span style={{ 'font-size': '9px', color: 'var(--text-dim)', 'font-family': 'JetBrains Mono, monospace' }}>
                        {new Date(pubDate).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
};
