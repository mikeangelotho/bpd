import type { WatcherPlugin, WatcherEvent } from '../types';

// ─── CORS PROXY ───
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
];

async function fetchWithCORS(url: string): Promise<Response> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) return resp;
  } catch {
    // Direct failed — try CORS proxies
  }

  for (const proxy of CORS_PROXIES) {
    try {
      const resp = await fetch(proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(8000) });
      if (resp.ok) return resp;
    } catch {
      continue;
    }
  }
  throw new Error(`All CORS proxies failed for ${url}`);
}

// ─── URL SCRAPER WATCHER ───
// Fetches a URL, extracts text content, detects changes from last snapshot
export const urlScraperPlugin: WatcherPlugin<{ url: string; content: string; changed: boolean }> = {
  id: 'url-scraper',
  name: 'URL Scraper',
  type: 'poll',
  defaultInterval: 600_000, // 10 minutes
  configSchema: {
    url: { type: 'string', required: true, label: 'Target URL', placeholder: 'https://...' },
    selector: { type: 'string', label: 'CSS Selector', placeholder: 'e.g. .main-content, article, #pricing' },
    notifyOnChange: { type: 'boolean', default: true, label: 'Notify on change' },
  },

  async fetch(config) {
    const url = config.url as string;
    const selector = config.selector as string | undefined;

    const resp = await fetchWithCORS(url);
    const html = await resp.text();

    // Parse and extract
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    let content: string;
    if (selector) {
      const el = doc.querySelector(selector);
      content = el?.textContent?.trim() ?? '';
    } else {
      // Fall back to body text, stripped of scripts/styles
      for (const tag of doc.querySelectorAll('script, style, nav, footer, header')) {
        tag.remove();
      }
      content = doc.body?.textContent?.trim() ?? '';
    }

    return { url, content, changed: false }; // change detection handled by store
  },

  parse(raw, config) {
    const events: WatcherEvent[] = [
      {
        id: `scraper-${Date.now()}`,
        watcherId: '',
        timestamp: Date.now(),
        type: 'data',
        severity: 'info',
        payload: {
          url: raw.url,
          contentPreview: raw.content.slice(0, 500),
          contentLength: raw.content.length,
          changed: raw.changed,
          source: 'scraper',
        },
      },
    ];

    if (raw.changed && config.notifyOnChange !== false) {
      events.push({
        id: `scraper-alert-${Date.now()}`,
        watcherId: '',
        timestamp: Date.now(),
        type: 'alert',
        severity: 'warn',
        payload: {
          message: `Page content changed at ${raw.url}`,
          url: raw.url,
          source: 'scraper',
        },
      });
    }

    return events;
  },
};
