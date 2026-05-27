import { type Component, For, Show, createMemo, createSignal, createEffect, onCleanup, Switch, Match } from 'solid-js';
import type { WatcherState, WatcherEvent } from '../types';

interface Props {
  watcher: WatcherState;
  compact?: boolean;
}

// ─── DISPATCH RENDERER ───
const BodyRenderer: Component<Props> = (props) => {
  const pluginId = () => props.watcher.pluginId;

  return (
    <Switch fallback={<GenericBody {...props} />}>
      <Match when={pluginId() === 'ticker'}><TickerBody {...props} /></Match>
      <Match when={pluginId() === 'rss-feed'}><NewsBody {...props} /></Match>
      <Match when={pluginId() === 'news-api'}><NewsBody {...props} /></Match>
      <Match when={pluginId() === 'url-scraper'}><ScraperBody {...props} /></Match>
      <Match when={pluginId() === 'trending'}><TrendingBody {...props} /></Match>
      <Match when={pluginId() === 'google-trends'}><TrendsBody {...props} /></Match>
      <Match when={pluginId() === 'adsb-exchange'}><ADSBBody {...props} /></Match>
      <Match when={pluginId() === 'open-meteo'}><WeatherBody {...props} /></Match>
    </Switch>
  );
};

export const CardBody: Component<Props> = (props) => {
  const w = () => props.watcher;

  return (
    <>
      <Show when={w().status === 'loading' && w().events.length === 0}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '12px', 'font-size': '10px', color: 'var(--accent-amber)' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', border: '1px solid var(--accent-amber)', 'border-top-color': 'transparent', 'border-radius': '50%', animation: 'spin 0.8s linear infinite' }} />
          Fetching data...
        </div>
      </Show>
      <Show when={w().status !== 'loading' || w().events.length > 0}>
        <BodyRenderer {...props} />
      </Show>
    </>
  );
};

// ─── TICKER BODY (crypto/stocks) ───
const TickerBody: Component<Props> = (props) => {
  const w = () => props.watcher;
  const compact = () => props.compact;

  // Extract latest event per symbol
  const latestBySymbol = createMemo(() => {
    const map = new Map<string, WatcherEvent>();
    // Iterate events in order, latest wins
    for (const ev of w().events) {
      const sym = ev.payload.symbol as string | undefined;
      if (sym) map.set(sym, ev);
    }
    return Array.from(map.values());
  });

  // Price history sparkline data per symbol
  const priceHistory = createMemo(() => {
    const history = new Map<string, number[]>();
    for (const ev of w().events) {
      const sym = ev.payload.symbol as string | undefined;
      const priceStr = ev.payload.price as string | undefined;
      if (sym && priceStr) {
        const price = parseFloat(priceStr.replace(/[$,]/g, ''));
        if (!isNaN(price)) {
          if (!history.has(sym)) history.set(sym, []);
          history.get(sym)!.push(price);
        }
      }
    }
    return history;
  });

  function renderSparkline(prices: number[]): string {
    if (prices.length < 2) return '';
    const recent = prices.slice(-20);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min || 1;
    const h = 24;
    const w = 260;
    const points = recent.map((p, i) => {
      const x = (i / (recent.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${x},${y}`;
    });

    const isUp = recent[recent.length - 1] >= recent[0];
    const color = isUp ? '#69f0ae' : '#ff5252';

    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="margin:4px 0">
      <polyline fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round" points="${points.join(' ')}" />
    </svg>`;
  }

  return (
    <div style={{ padding: '0 12px 10px' }}>
      <For each={latestBySymbol()}>
        {(ev) => {
          const sym = ev.payload.symbol as string;
          const price = ev.payload.price as string;
          const change = ev.payload.change as string;
          const history = priceHistory().get(sym) ?? [];

          return (
            <div style={{ 'margin-bottom': '10px', 'border-bottom': '1px solid rgba(26, 26, 46, 0.4)', 'padding-bottom': '8px' }}>
              <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px' }}>
                <span style={{ 'font-size': '16px', 'font-weight': 600, color: 'var(--text-primary)' }}>
                  {sym}
                </span>
                <span style={{ 'font-size': '14px', color: 'var(--text-primary)' }}>
                  {price}
                </span>
                <span
                  style={{
                    'font-size': '12px',
                    color: change.includes('+') ? 'var(--accent-green)' : change.includes('-') ? 'var(--accent-red)' : 'var(--text-muted)',
                  }}
                >
                  {change}
                </span>
              </div>

              <Show when={!compact() && history.length >= 2}>
                <div style={{ margin: '4px 0' }}>
                  {/* eslint-disable-next-line solid/no-innerhtml */}
                  <div innerHTML={renderSparkline(history)} />
                </div>
              </Show>

              <Show when={ev.payload.marketCap}>
                <div style={{ 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '2px' }}>
                  MCap: {String(ev.payload.marketCap)}
                </div>
              </Show>
            </div>
          );
        }}
      </For>

      {/* Footer */}
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)' }}>
        <span>{latestBySymbol().length} symbols</span>
        <span>{w().events.length} ticks</span>
      </div>
    </div>
  );
};

// ─── NEWS BODY (RSS feeds) — Carousel with prev/next teases ───

// Reusable image container (16:9, bulletproof scaling)
const ArticleImage = (props: { src: string | undefined; alt?: string; onError: () => void }) => {
  const hue = props.alt
    ? props.alt.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 360
    : 200;
  const initials = (props.alt || '?')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const gradientBg = `linear-gradient(135deg, hsl(${hue}, 40%, 18%), hsl(${(hue + 40) % 360}, 50%, 12%))`;

  if (!props.src) {
    return (
      <div style={{
        position: 'absolute',
        inset: 0,
        'background-image': gradientBg,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
      }}>
        <span style={{ 'font-size': '24px', 'font-weight': 700, color: `hsl(${hue}, 60%, 70%)`, opacity: 0.35, 'letter-spacing': '0.1em' }}>
          {initials}
        </span>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <img
        src={props.src}
        alt=""
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          'object-fit': 'cover', display: 'block',
          /* Subtle cyberpunk shift: cool cyan-magenta tint, slight contrast boost */
          filter: 'saturate(1.15) contrast(1.08) brightness(0.92) hue-rotate(8deg)',
        }}
        onError={props.onError}
      />
      {/* Scanline texture overlay */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.03) 2px, rgba(0,229,255,0.03) 4px)',
          'pointer-events': 'none',
          mixBlendMode: 'overlay',
        }}
      />
      {/* Very subtle magenta vignette */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(180,0,255,0.08) 100%)',
          'pointer-events': 'none',
        }}
      />
    </div>
  );
};

const NewsBody: Component<Props> = (props) => {
  const w = () => props.watcher;
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [imgError, setImgError] = createSignal(false);
  const [rotateToken, setRotateToken] = createSignal(0); // reset auto-rotate on manual nav
  const [paused, setPaused] = createSignal(false);

  const articles = createMemo(() => {
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

  const articleCount = createMemo(() => articles().length);

  // Auto-rotate every 6s — recreated on token change (manual nav resets it)
  createEffect(() => {
    rotateToken(); // subscribe to reset signal
    const n = articleCount();
    if (n <= 1) return;
    const timer = setInterval(() => {
      if (paused()) return;
      setCurrentIndex((prev) => (prev + 1) % n);
      setImgError(false);
    }, 6000);
    onCleanup(() => clearInterval(timer));
  });

  function navigate(delta: number) {
    const n = articleCount();
    if (n <= 1) return;
    setCurrentIndex((prev) => ((prev + delta) % n + n) % n);
    setImgError(false);
    setRotateToken((t) => t + 1); // reset auto-rotate timer
  }

  function goTo(idx: number) {
    setCurrentIndex(idx);
    setImgError(false);
    setRotateToken((t) => t + 1); // reset auto-rotate timer
  }

  function handleImageError() {
    setImgError(true);
  }

  // Helper to get article with wraparound
  function getArticle(offset: number) {
    const items = articles();
    if (items.length === 0) return null;
    const n = items.length;
    return items[((currentIndex() + offset) % n + n) % n];
  }

  // Render a single article card (main or teaser)
  function renderArticle(ev: ReturnType<typeof getArticle>, opts: { main?: boolean; delta?: number }) {
    if (!ev) return null;
    const title = ev.payload.title as string;
    const link = ev.payload.link as string | undefined;
    const image = (ev.payload.image as string | undefined) || '';
    const desc = (ev.payload.description as string | undefined) || '';
    const time = new Date(ev.timestamp);
    const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
    const showImage = image.length > 0 && (!opts.main || !imgError());

    const truncated = opts.main
      ? (title.length > 100 ? title.slice(0, 100) + '...' : title)
      : (title.length > 50 ? title.slice(0, 50) + '...' : title);
    const truncatedDesc = opts.main
      ? (desc.length > 150 ? desc.slice(0, 150) + '...' : desc)
      : (desc.length > 60 ? desc.slice(0, 60) + '...' : desc);

    const content = (
      <>
        {/* Image area */}
        {opts.main ? (
          <div style={{ position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', overflow: 'hidden', 'border-radius': '2px', 'margin-bottom': '6px', border: '1px solid var(--border)' }}>
            <Show
              when={showImage}
              fallback={<ArticleImage src={undefined} alt={title} onError={handleImageError} />}
            >
              <ArticleImage src={image} alt={title} onError={handleImageError} />
            </Show>

            {/* Nav chevrons — angular, cyberpunk style */}
            <Show when={articleCount() > 1}>
              <button
                onClick={(e) => { e.stopPropagation(); navigate(-1); }}
                style={{
                  position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                  width: '28px', height: '28px', border: '1px solid var(--accent-cyan)',
                  background: 'rgba(0,0,0,0.7)', color: 'var(--accent-cyan)', 'font-size': '14px',
                  'font-family': 'JetBrains Mono, monospace', 'font-weight': 700,
                  cursor: 'pointer', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                  padding: 0, 'line-height': 1, 'clip-path': 'polygon(4px 0, 100% 0, 24px 100%, 0 100%)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,229,255,0.2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.7)'; }}
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); navigate(1); }}
                style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  width: '28px', height: '28px', border: '1px solid var(--accent-cyan)',
                  background: 'rgba(0,0,0,0.7)', color: 'var(--accent-cyan)', 'font-size': '14px',
                  'font-family': 'JetBrains Mono, monospace', 'font-weight': 700,
                  cursor: 'pointer', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                  padding: 0, 'line-height': 1, 'clip-path': 'polygon(0 0, 24px 0, 100% 100%, 4px 100%)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,229,255,0.2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.7)'; }}
              >
                ›
              </button>
            </Show>
          </div>
        ) : (
          <Show when={showImage}>
            <div style={{ position: 'relative', width: '48px', height: '36px', 'flex-shrink': 0, overflow: 'hidden', 'border-radius': '2px', border: '1px solid var(--border)' }}>
              <ArticleImage src={image} alt={title} onError={() => {}} />
            </div>
          </Show>
        )}

        {/* Headline */}
        <div
          style={{
            'font-size': opts.main ? '12px' : '10px',
            color: opts.main ? 'var(--text-primary)' : 'var(--text-muted)',
            'line-height': '1.4',
            flex: 1,
            'min-width': 0,
            /* Clamp to 2 lines for stable card height */
            ...(opts.main
              ? { display: '-webkit-box', '-webkit-line-clamp': 2, '-webkit-box-orient': 'vertical', overflow: 'hidden' }
              : {}),
          }}
        >
          {link && opts.main ? (
            <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', 'text-decoration': 'none' }} onClick={(e) => e.stopPropagation()} onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }} onMouseLeave={(e) => { (e.target as HTMLElement).style.color = opts.main ? 'var(--text-primary)' : 'var(--text-muted)'; }}>
              {truncated}
            </a>
          ) : (
            <span>{truncated}</span>
          )}
        </div>

        {/* Description (main only) — always rendered at fixed height to prevent card reflow */}
        <Show
          when={opts.main && desc.length > 0}
          fallback={opts.main ? <div style={{ height: '2.5em', 'margin-bottom': '3px' }} /> : null}
        >
          <div
            style={{
              'font-size': '10px',
              color: 'var(--text-muted)',
              'line-height': '1.5',
              'margin-bottom': '3px',
              /* Clamp to 2 lines so card height stays stable during carousel rotation */
              display: '-webkit-box',
              '-webkit-line-clamp': 2,
              '-webkit-box-orient': 'vertical',
              overflow: 'hidden',
              'min-height': '2.5em',
            }}
          >
            {truncatedDesc}
          </div>
        </Show>

        {/* Timestamp (main only) */}
        <Show when={opts.main}>
          <div style={{ 'font-size': '9px', color: 'var(--text-dim)' }}>{timeStr}</div>
        </Show>
      </>
    );

    if (opts.main) {
      return <div style={{ display: 'flex', 'flex-direction': 'column' }}>{content}</div>;
    }

    // Teaser — clickable to navigate
    const delta = opts.delta ?? 1;
    return (
      <div
        onClick={() => { navigate(delta); }}
        style={{ display: 'flex', gap: '6px', 'align-items': 'center', cursor: 'pointer', padding: '4px', 'border-radius': '2px', transition: 'background 0.15s' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ padding: '0 12px 10px', display: 'flex', 'flex-direction': 'column', gap: '6px', 'min-height': '280px' }}
    >
      <Show when={articleCount() > 0}>
        {() => {
          const prev = getArticle(-1);
          const curr = getArticle(0);
          const next = getArticle(1);

          return (
            <>
              {/* Previous tease */}
              <Show when={articleCount() > 1 && prev}>
                <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', opacity: 0.5, 'padding-top': '2px' }}>
                  <span style={{ 'font-size': '8px', color: 'var(--text-dim)', width: '12px', 'text-align': 'right', 'flex-shrink': 0 }}>▲</span>
                  {renderArticle(prev, { main: false, delta: -1 })}
                </div>
              </Show>

              {/* Current article */}
              <div style={{ 'border-top': articleCount() > 1 ? '1px solid var(--border)' : 'none', 'padding-top': articleCount() > 1 ? '6px' : 0 }}>
                {renderArticle(curr, { main: true })}
              </div>

              {/* Next tease */}
              <Show when={articleCount() > 1 && next}>
                <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', opacity: 0.5, 'padding-bottom': '2px' }}>
                  <span style={{ 'font-size': '8px', color: 'var(--text-dim)', width: '12px', 'text-align': 'right', 'flex-shrink': 0 }}>▼</span>
                  {renderArticle(next, { main: false, delta: 1 })}
                </div>
              </Show>
            </>
          );
        }}
      </Show>

      {/* Footer */}
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '2px' }}>
        <span>{articleCount()} articles</span>
        <span>{articleCount() > 1 ? `${(currentIndex() % articleCount()) + 1}/${articleCount()}` : 'auto-rotating'}</span>
      </div>
    </div>
  );
};

// ─── SCRAPER BODY ───
const ScraperBody: Component<Props> = (props) => {
  const w = () => props.watcher;

  const latest = createMemo(() => {
    return w().events.filter((ev) => ev.payload.contentLength !== undefined).pop();
  });

  const changes = createMemo(() => {
    return w().events.filter((ev) => ev.payload.changed === true);
  });

  return (
    <div style={{ padding: '0 12px 10px' }}>
      <Show when={latest()}>
        {(ev) => (
          <>
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', 'margin-bottom': '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Content size</span>
              <span style={{ color: 'var(--text-primary)' }}>
                {(ev().payload.contentLength as number).toLocaleString()} chars
              </span>
            </div>

            <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', 'margin-bottom': '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Changes detected</span>
              <span style={{ color: changes().length > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                {changes().length}
              </span>
            </div>

            <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', 'margin-bottom': '8px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Preview</span>
            </div>
            <div
              style={{
                'font-size': '10px',
                color: 'var(--text-muted)',
                'background': 'rgba(0,0,0,0.2)',
                padding: '6px 8px',
                'border-left': '2px solid var(--border)',
                'max-height': '60px',
                overflow: 'hidden',
                'white-space': 'pre-wrap',
                'line-height': '1.5',
              }}
            >
              {(ev().payload.contentPreview as string)?.slice(0, 200)}
            </div>
          </>
        )}
      </Show>

      <Show when={changes().length > 0}>
        <div style={{ 'font-size': '10px', color: 'var(--accent-amber)', 'margin-top': '6px' }}>
          ⚠ Last change: {new Date(changes()[changes().length - 1].timestamp).toLocaleTimeString()}
        </div>
      </Show>

      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '6px' }}>
        <span>{w().events.length} scrapes</span>
      </div>
    </div>
  );
};

// ─── GENERIC BODY (fallback for demo, unknown types) ───
const GenericBody: Component<Props> = (props) => {
  const w = () => props.watcher;
  const recentEvents = () => w().events.slice(-8).reverse();

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  function renderEventPayload(ev: WatcherEvent) {
    const p = ev.payload;
    const entries = Object.entries(p).filter(([k]) => k !== 'source' && k !== 'type');

    return (
      <For each={entries}>
        {([key, val]) => (
          <div style={{ display: 'flex', 'justify-content': 'space-between', padding: '1px 0' }}>
            <span style={{ color: 'var(--text-muted)', 'font-size': '11px' }}>{key}</span>
            <span style={{ 'font-size': '12px', color: 'var(--text-primary)' }}>
              {String(val).slice(0, 40)}
            </span>
          </div>
        )}
      </For>
    );
  }

  return (
    <div style={{ padding: '0 12px 10px' }}>
      <Show when={recentEvents().length === 0}>
        <div style={{ color: 'var(--text-dim)', 'font-size': '10px', padding: '8px 0', 'text-align': 'center' }}>
          No data yet...
        </div>
      </Show>

      <For each={recentEvents()}>
        {(ev) => (
          <div style={{ padding: '3px 0', 'border-bottom': '1px solid rgba(26, 26, 46, 0.4)' }}>
            <div style={{ display: 'flex', gap: '8px', 'font-size': '10px' }}>
              <span style={{ color: 'var(--text-dim)', 'min-width': '36px', 'flex-shrink': 0 }}>
                {formatTime(ev.timestamp)}
              </span>
              <span style={{ color: ev.severity === 'warn' ? 'var(--accent-amber)' : ev.severity === 'error' ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                {renderEventPayload(ev)}
              </span>
            </div>
          </div>
        )}
      </For>

      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '6px' }}>
        <span>{w().events.length} events</span>
        <span>updated {w().lastFetch ? `${Math.round((Date.now() - w().lastFetch) / 1000)}s ago` : 'never'}</span>
      </div>
    </div>
  );
};

// ─── TRENDING BODY (Reddit + HN) — Velocity-sorted list ───
const TrendingBody: Component<Props> = (props) => {
  const w = () => props.watcher;

  // Get latest events (deduplicated by title)
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

  function velocityBarWidth(velocity: number, maxVelocity: number): string {
    if (maxVelocity === 0) return '0%';
    return `${Math.min(100, (velocity / maxVelocity) * 100)}%`;
  }

  const maxVelocity = createMemo(() => {
    const items = trendingItems();
    if (items.length === 0) return 0;
    return Math.max(...items.map((ev) => (ev.payload.velocity as number) || 0));
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'max-height': '280px', 'min-height': 0 }}>
      <div style={{ padding: '0 12px 10px', overflow: 'auto', 'min-height': 0, flex: 1 }}>
      <Show when={trendingItems().length === 0}>
        <div style={{ color: 'var(--text-dim)', 'font-size': '10px', padding: '8px 0', 'text-align': 'center' }}>
          Fetching trending...
        </div>
      </Show>

      <For each={trendingItems()}>
        {(ev, idx) => {
          const title = ev.payload.title as string;
          const link = ev.payload.link as string;
          const source = ev.payload.source as string;
          const velocity = (ev.payload.velocity as number) || 0;
          const comments = (ev.payload.comments as number) || 0;
          const ageMin = (ev.payload.ageMinutes as number) || 0;
          const score = (ev.payload.score as number) || 0;
          const rank = idx() + 1;

          return (
            <div
              style={{
                'margin-bottom': '8px',
                'padding-bottom': '8px',
                'border-bottom': rank < trendingItems().length ? '1px solid rgba(26, 26, 46, 0.4)' : 'none',
              }}
            >
              {/* Rank + Title */}
              <div style={{ display: 'flex', gap: '8px', 'align-items': 'flex-start', 'margin-bottom': '4px' }}>
                {/* Angular rank badge */}
                <div
                  style={{
                    'flex-shrink': 0,
                    width: '20px',
                    height: '20px',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    'font-size': '10px',
                    'font-weight': 700,
                    'font-family': 'JetBrains Mono, monospace',
                    color: velocityColor(velocity),
                    background: 'rgba(0,0,0,0.4)',
                    border: `1px solid ${velocityColor(velocity)}`,
                    'clip-path': 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
                    'margin-top': '1px',
                  }}
                >
                  {rank}
                </div>

                {/* Title link */}
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    'font-size': '11px',
                    'font-weight': 500,
                    color: 'var(--text-primary)',
                    'line-height': '1.35',
                    'text-decoration': 'none',
                    'word-break': 'break-word',
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-primary)'; }}
                >
                  {title}
                </a>
              </div>

              {/* Meta row: source tag, velocity bar, stats */}
              <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'margin-left': '28px' }}>
                {/* Source tag */}
                <span
                  style={{
                    'font-size': '9px',
                    'font-family': 'JetBrains Mono, monospace',
                    color: source === 'hacker-news' ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                    background: source === 'hacker-news' ? 'rgba(255,167,38,0.1)' : 'rgba(0,229,255,0.08)',
                    border: `1px solid ${source === 'hacker-news' ? 'rgba(255,167,38,0.25)' : 'rgba(0,229,255,0.15)'}`,
                    padding: '1px 5px',
                    'border-radius': '2px',
                    'flex-shrink': 0,
                    'text-transform': 'uppercase',
                    'letter-spacing': '0.05em',
                  }}
                >
                  {source}
                </span>

                {/* Velocity bar */}
                <div
                  style={{
                    flex: 1,
                    height: '3px',
                    background: 'rgba(255,255,255,0.05)',
                    'border-radius': '1px',
                    overflow: 'hidden',
                    'min-width': '40px',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: velocityBarWidth(velocity, maxVelocity()),
                      background: velocityColor(velocity),
                      'border-radius': '1px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                {/* Stats */}
                <span style={{ 'font-size': '9px', color: 'var(--text-dim)', 'flex-shrink': 0, 'font-family': 'JetBrains Mono, monospace' }}>
                  ▲{score} 💬{comments} {timeAgo(ageMin)}
                </span>
              </div>
            </div>
          );
        }}
      </For>

      {/* Footer */}
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '6px' }}>
        <span>{trendingItems().length} trending</span>
        <span>updated {w().lastFetch ? `${Math.round((Date.now() - w().lastFetch) / 1000)}s ago` : 'never'}</span>
      </div>
      </div>
    </div>
  );
};

// ─── GOOGLE TRENDS BODY — Ranked by search volume ───
const TrendsBody: Component<Props> = (props) => {
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

  function trafficBarWidth(traffic: string, maxTraffic: number): string {
    const n = parseInt(traffic, 10) || 0;
    if (maxTraffic === 0) return '0%';
    return `${Math.min(100, (n / maxTraffic) * 100)}%`;
  }

  const maxTraffic = createMemo(() => {
    const items = trendItems();
    if (items.length === 0) return 0;
    return Math.max(...items.map((ev) => parseInt((ev.payload.traffic as string) || '0', 10) || 0));
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'max-height': '280px', 'min-height': 0 }}>
      <div style={{ padding: '0 12px 10px', overflow: 'auto', 'min-height': 0, flex: 1 }}>
      <Show when={trendItems().length === 0}>
        <div style={{ color: 'var(--text-dim)', 'font-size': '10px', padding: '8px 0', 'text-align': 'center' }}>
          Fetching trends...
        </div>
      </Show>

      <For each={trendItems()}>
        {(ev, idx) => {
          const title = ev.payload.title as string;
          const link = ev.payload.link as string;
          const traffic = ev.payload.traffic as string;
          const newsCount = ev.payload.newsCount as number;
          const rank = idx() + 1;

          return (
            <div
              style={{
                'margin-bottom': '8px',
                'padding-bottom': '8px',
                'border-bottom': rank < trendItems().length ? '1px solid rgba(26, 26, 46, 0.4)' : 'none',
              }}
            >
              {/* Rank + Title */}
              <div style={{ display: 'flex', gap: '8px', 'align-items': 'flex-start', 'margin-bottom': '4px' }}>
                {/* Angular rank badge */}
                <div
                  style={{
                    'flex-shrink': 0,
                    width: '20px',
                    height: '20px',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    'font-size': '10px',
                    'font-weight': 700,
                    'font-family': 'JetBrains Mono, monospace',
                    color: trafficColor(traffic),
                    background: 'rgba(0,0,0,0.4)',
                    border: `1px solid ${trafficColor(traffic)}`,
                    'clip-path': 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
                    'margin-top': '1px',
                  }}
                >
                  {rank}
                </div>

                {/* Title link */}
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    'font-size': '11px',
                    'font-weight': 500,
                    color: 'var(--text-primary)',
                    'line-height': '1.35',
                    'text-decoration': 'none',
                    'word-break': 'break-word',
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent-cyan)'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-primary)'; }}
                >
                  {title}
                </a>
              </div>

              {/* Meta row: traffic bar + stats */}
              <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'margin-left': '28px' }}>
                {/* Source tag */}
                <span
                  style={{
                    'font-size': '9px',
                    'font-family': 'JetBrains Mono, monospace',
                    color: 'var(--accent-amber)',
                    background: 'rgba(255,167,38,0.1)',
                    border: '1px solid rgba(255,167,38,0.25)',
                    padding: '1px 5px',
                    'border-radius': '2px',
                    'flex-shrink': 0,
                    'text-transform': 'uppercase',
                    'letter-spacing': '0.05em',
                  }}
                >
                  🔥 trends
                </span>

                {/* Traffic bar */}
                <div
                  style={{
                    flex: 1,
                    height: '3px',
                    background: 'rgba(255,255,255,0.05)',
                    'border-radius': '1px',
                    overflow: 'hidden',
                    'min-width': '40px',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: trafficBarWidth(traffic, maxTraffic()),
                      background: trafficColor(traffic),
                      'border-radius': '1px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                {/* Stats */}
                <span style={{ 'font-size': '9px', color: 'var(--text-dim)', 'flex-shrink': 0, 'font-family': 'JetBrains Mono, monospace' }}>
                  ▲{traffic} 📰{newsCount || 0}
                </span>
              </div>
            </div>
          );
        }}
      </For>

      {/* Footer */}
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '6px' }}>
        <span>{trendItems().length} trends</span>
        <span>updated {w().lastFetch ? `${Math.round((Date.now() - w().lastFetch) / 1000)}s ago` : 'never'}</span>
      </div>
      </div>
    </div>
  );
};

// ─── ADS-B EXCHANGE BODY — Aircraft list ───
const ADSBBody: Component<Props> = (props) => {
  const w = () => props.watcher;

  const aircraftList = createMemo(() => {
    const seen = new Set<string>();
    return w().events
      .filter((ev) => ev.payload.callsign || ev.payload.hex)
      .filter((ev) => {
        const hex = ev.payload.hex as string;
        if (seen.has(hex)) return false;
        seen.add(hex);
        return true;
      });
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'max-height': '280px', 'min-height': 0 }}>
      <div style={{ padding: '0 12px 10px', overflow: 'auto', 'min-height': 0, flex: 1 }}>
      <Show when={aircraftList().length === 0}>
        <div style={{ color: 'var(--text-dim)', 'font-size': '10px', padding: '8px 0', 'text-align': 'center' }}>
          Scanning airspace...
        </div>
      </Show>

      <For each={aircraftList()}>
        {(ev) => {
          const callsign = (ev.payload.callsign as string) || 'N/A';
          const altitude = (ev.payload.altitude as number) || 0;
          const speed = (ev.payload.speed as number) || 0;
          const heading = (ev.payload.heading as number) || 0;
          const squawk = (ev.payload.squawk as string) || '';
          const reg = (ev.payload.registration as string) || '';

          return (
            <div
              style={{
                'margin-bottom': '6px',
                'padding-bottom': '6px',
                'border-bottom': '1px solid rgba(26, 26, 46, 0.3)',
              }}
            >
              {/* Callsign + Registration */}
              <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '2px' }}>
                <span style={{ 'font-size': '11px', 'font-weight': 600, color: 'var(--accent-cyan)', 'font-family': 'JetBrains Mono, monospace' }}>
                  {callsign}
                </span>
                <Show when={reg}>
                  <span style={{ 'font-size': '9px', color: 'var(--text-dim)', 'font-family': 'JetBrains Mono, monospace' }}>
                    {reg}
                  </span>
                </Show>
              </div>

              {/* Stats row */}
              <div style={{ display: 'flex', gap: '8px', 'font-size': '9px', 'font-family': 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
                <span>ALT {altitude.toLocaleString()}ft</span>
                <span>SPD {speed}kt</span>
                <span>HDG {heading}°</span>
                <Show when={squawk}>
                  <span style={{ color: 'var(--accent-amber)' }}>SQ {squawk}</span>
                </Show>
              </div>
            </div>
          );
        }}
      </For>

      {/* Footer */}
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '6px' }}>
        <span>{aircraftList().length} aircraft</span>
        <span>updated {w().lastFetch ? `${Math.round((Date.now() - w().lastFetch) / 1000)}s ago` : 'never'}</span>
      </div>
      </div>
    </div>
  );
};

// ─── OPEN-METEO WEATHER BODY ───
const WeatherBody: Component<Props> = (props) => {
  const w = () => props.watcher;

  const weatherData = createMemo(() => {
    const seen = new Set<string>();
    return w().events
      .filter((ev) => ev.payload.location)
      .filter((ev) => {
        const loc = ev.payload.location as string;
        if (seen.has(loc)) return false;
        seen.add(loc);
        return true;
      });
  });

  const weatherEmoji = (condition: string): string => {
    if (condition.includes('clear')) return '☀️';
    if (condition.includes('mostly clear')) return '🌤';
    if (condition.includes('partly')) return '⛅';
    if (condition.includes('overcast')) return '☁️';
    if (condition.includes('rain') || condition.includes('shower')) return '🌧';
    if (condition.includes('snow')) return '❄️';
    if (condition.includes('thunder')) return '⛈';
    if (condition.includes('fog')) return '🌫';
    return '🌡';
  };

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'max-height': '280px', 'min-height': 0 }}>
      <div style={{ padding: '0 12px 10px', overflow: 'auto', 'min-height': 0, flex: 1 }}>
      <Show when={weatherData().length === 0}>
        <div style={{ color: 'var(--text-dim)', 'font-size': '10px', padding: '8px 0', 'text-align': 'center' }}>
          Fetching weather...
        </div>
      </Show>

      <For each={weatherData()}>
        {(ev) => {
          const location = ev.payload.location as string;
          const temp = (ev.payload.temperature as number) || 0;
          const condition = (ev.payload.condition as string) || '';
          const windspeed = (ev.payload.windspeed as number) || 0;
          const winddir = (ev.payload.winddirection as number) || 0;
          const isDay = (ev.payload.isDay as number) || 1;

          return (
            <div
              style={{
                'margin-bottom': '8px',
                'padding-bottom': '8px',
                'border-bottom': '1px solid rgba(26, 26, 46, 0.3)',
              }}
            >
              {/* Location + emoji */}
              <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '4px' }}>
                <span style={{ 'font-size': '11px', 'font-weight': 600, color: 'var(--accent-magenta)', 'font-family': 'JetBrains Mono, monospace' }}>
                  {weatherEmoji(condition)} {location}
                </span>
                <span style={{ 'font-size': '9px', color: isDay ? 'var(--accent-amber)' : 'var(--text-dim)' }}>
                  {isDay ? '☀️' : '🌙'}
                </span>
              </div>

              {/* Stats row */}
              <div style={{ display: 'flex', gap: '8px', 'font-size': '9px', 'font-family': 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
                <span style={{ color: temp > 30 ? 'var(--accent-red)' : temp < 10 ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                  {temp}°C
                </span>
                <span>{condition}</span>
                <span>🌬 {windspeed}km/h {winddir}°</span>
              </div>
            </div>
          );
        }}
      </For>

      {/* Footer */}
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '6px' }}>
        <span>{weatherData().length} locations</span>
        <span>updated {w().lastFetch ? `${Math.round((Date.now() - w().lastFetch) / 1000)}s ago` : 'never'}</span>
      </div>
      </div>
    </div>
  );
};
