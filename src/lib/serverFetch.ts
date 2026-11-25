// ─── SHARED CLIENT FETCH HELPER ───
// Single entry point for all cross-origin data fetching in the browser.
//
// Primary path: the same-origin Vite server proxy (`/api/fetch?url=...`), which runs
// in Node and therefore has no CORS or mixed-content restrictions. It also sends a
// real browser User-Agent so sources that block datacenter/proxy IPs (e.g. Reddit)
// respond normally.
//
// Fallback path: the public CORS proxies the app previously relied on. These are
// flaky, but keeping them means a static/prod build (no Node server) still degrades
// rather than dying outright.

const PUBLIC_CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];

export interface ServerFetchOptions {
  /** Per-attempt timeout in milliseconds. Default 12s. */
  timeoutMs?: number;
  /** Extra request headers to forward to the upstream (server-proxy path only). */
  headers?: Record<string, string>;
}

/**
 * Fetch a cross-origin URL via the server proxy, falling back to public CORS proxies.
 *
 * The returned Response carries the upstream status code (including 4xx/5xx such as
 * 429 rate limits) so callers can inspect `resp.status`. A 502 from the server proxy
 * means it couldn't reach the upstream — that triggers the public-proxy fallback.
 */
export async function serverFetch(url: string, opts: ServerFetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 12000;

  // 1. Same-origin server proxy (primary)
  try {
    const headers: Record<string, string> = {};
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        headers[`x-proxy-header-${k}`] = v;
      }
    }
    const resp = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 502 is the proxy's own "couldn't reach upstream" signal — fall through.
    if (resp.status !== 502) return resp;
  } catch {
    // Server proxy unavailable (e.g. static build with no Node server) — fall through.
  }

  // 2. Public CORS proxies (fallback)
  for (const proxy of PUBLIC_CORS_PROXIES) {
    try {
      const resp = await fetch(proxy + encodeURIComponent(url), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) return resp;
    } catch {
      continue;
    }
  }

  throw new Error(`serverFetch: all fetch paths failed for ${url}`);
}
