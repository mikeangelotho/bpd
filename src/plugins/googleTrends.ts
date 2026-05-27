import type { WatcherPlugin, WatcherEvent } from '../types';

// ─── CORS PROXY ───
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
];

async function fetchWithCORS(url: string): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) return resp;
  } catch {
    // Direct failed
  }

  for (const proxy of CORS_PROXIES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(proxy + encodeURIComponent(url), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (resp.ok) return resp;
    } catch {
      continue;
    }
  }
  throw new Error(`All CORS proxies failed for ${url}`);
}

// ─── GOOGLE TRENDING TOPIC ───
interface TrendingTopic {
  title: string;
  traffic: string;        // "1000+", "500+", etc.
  picture: string;
  pictureSource: string;
  newsItems: {
    title: string;
    url: string;
    source: string;
    picture: string;
  }[];
  pubDate: string;
}

// ─── TREND ITEM (unified) ───
interface TrendItem {
  title: string;
  link: string;
  source: string;
  thumbnail: string;
  traffic: string;
  pubDate: string;
  newsCount: number;
}

// Parse a numeric-ish traffic value for sorting
function trafficToNumber(traffic: string): number {
  const match = traffic.match(/(\d+)/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

// ─── GOOGLE TRENDS PLUGIN ───
export const googleTrendsPlugin: WatcherPlugin<{ items: TrendItem[] }> = {
  id: 'google-trends',
  name: 'Google Trends',
  type: 'poll',
  defaultInterval: 1_800_000, // 30 minutes
  configSchema: {
    geo: { type: 'string', default: 'US', label: 'Country code', placeholder: 'US, GB, JP, DE, etc.' },
    maxItems: { type: 'number', default: 25, label: 'Max items' },
    minTraffic: { type: 'number', default: 50, label: 'Min traffic threshold' },
  },

  async fetch(config) {
    // Apply schema defaults
    const schema = this.configSchema as Record<string, { default?: unknown }>;
    const merged: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema)) {
      merged[key] = (config[key] !== undefined && config[key] !== '') ? config[key] : field.default;
    }

    const geo = (merged.geo as string) || 'US';
    const maxItems = Number(merged.maxItems) || 25;
    const minTraffic = Number(merged.minTraffic) || 50;

    const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
    console.log(`[google-trends] Fetching: ${url}`);

    const resp = await fetchWithCORS(url);

    if (!resp.ok) {
      throw new Error(`Google Trends returned HTTP ${resp.status}`);
    }

    const text = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Failed to parse Google Trends RSS');
    }

    // Helper: query by local name, ignoring namespace prefix
    function byLocalName(parent: Element, localName: string): Element | null {
      // Try direct (non-namespaced) first
      const direct = parent.querySelector(localName);
      if (direct) return direct;
      // Then try all children and match by localName
      const all = parent.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        if (all[i].localName === localName) return all[i];
      }
      return null;
    }

    function byLocalNameAll(parent: Element, localName: string): Element[] {
      const result: Element[] = [];
      const all = parent.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        if (all[i].localName === localName) result.push(all[i]);
      }
      return result;
    }

    const items = doc.querySelectorAll('item');
    const results: TrendItem[] = [];

    for (const item of Array.from(items)) {
      const title = item.querySelector('title')?.textContent?.trim() || '';
      if (!title) continue;

      const trafficEl = byLocalName(item, 'approx_traffic');
      const traffic = trafficEl?.textContent?.trim() || '0';
      const trafficNum = trafficToNumber(traffic);
      if (trafficNum < minTraffic) continue;

      const picture = byLocalName(item, 'picture')?.textContent?.trim() || '';
      const pictureSource = byLocalName(item, 'picture_source')?.textContent?.trim() || '';

      const link = item.querySelector('link')?.textContent?.trim() || `https://trends.google.com/trending?geo=${geo}`;
      const pubDate = item.querySelector('pubDate')?.textContent?.trim() || '';

      // Collect related news items
      const newsEls = byLocalNameAll(item, 'news_item');
      const newsItems: { title: string; url: string; source: string; picture: string }[] = [];
      for (const ne of newsEls) {
        const nTitle = byLocalName(ne, 'news_item_title')?.textContent?.trim() || '';
        const nUrl = byLocalName(ne, 'news_item_url')?.textContent?.trim() || '';
        const nSource = byLocalName(ne, 'news_item_source')?.textContent?.trim() || '';
        const nPic = byLocalName(ne, 'news_item_picture')?.textContent?.trim() || '';
        if (nTitle || nUrl) {
          newsItems.push({ title: nTitle, url: nUrl, source: nSource, picture: nPic });
        }
      }

      results.push({
        title,
        link,
        source: 'google-trends',
        thumbnail: picture,
        traffic,
        pubDate,
        newsCount: newsItems.length,
      });
    }

    // Sort by traffic descending
    results.sort((a, b) => trafficToNumber(b.traffic) - trafficToNumber(a.traffic));

    return { items: results.slice(0, maxItems) };
  },

  parse(raw, _config) {
    const events: WatcherEvent[] = [];
    for (const item of raw.items) {
      events.push({
        id: `g-trends-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        watcherId: '',
        timestamp: Date.now(),
        type: 'data',
        severity: trafficToNumber(item.traffic) > 500 ? 'warn' : 'info',
        payload: {
          title: item.title,
          link: item.link,
          source: item.source,
          thumbnail: item.thumbnail || '',
          traffic: item.traffic,
          pubDate: item.pubDate,
          newsCount: item.newsCount,
          category: 'trends',
        },
      });
    }
    return events;
  },
};
