import type { WatcherPlugin, WatcherEvent } from '../types';
import { serverFetch } from '../lib/serverFetch';

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

    const resp = await serverFetch(url);
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
