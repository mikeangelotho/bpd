import type { WatcherPlugin, WatcherEvent } from '../types';

// ─── CORS PROXIES (same as RSS) ───
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
];

async function fetchWithCORS(url: string, apiKey: string): Promise<Response> {
  // Try direct first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'X-Api-Key': apiKey },
    });
    clearTimeout(timeoutId);
    if (resp.ok) return resp;
  } catch {
    // Direct failed
  }

  // Fall back to CORS proxies
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
  throw new Error(`All CORS proxies failed for NewsAPI`);
}

// ─── ENDPOINT ───
const BASE_URL = 'https://newsapi.org/v2';

// ─── NEWS API WATCHER ───
export const newsApiPlugin: WatcherPlugin<{ items: Array<Record<string, string>> }> = {
  id: 'news-api',
  name: 'News API',
  type: 'poll',
  defaultInterval: 300_000,
  configSchema: {
    apiKey: { type: 'string', required: true, label: 'API Key', placeholder: 'Your NewsAPI key' },
    mode: {
      type: 'select',
      default: 'top-headlines',
      label: 'Mode',
      options: ['top-headlines', 'everything'],
    },
    country: { type: 'string', default: 'us', label: 'Country', placeholder: 'us, gb, ca, au, in, de, fr' },
    category: { type: 'string', default: '', label: 'Category', placeholder: 'business, technology, sports, health, science, entertainment, general' },
    query: { type: 'string', default: '', label: 'Search query', placeholder: 'Keywords or "exact phrase"' },
    language: { type: 'string', default: 'en', label: 'Language', placeholder: 'en, es, fr, de, zh, ar' },
    sortBy: { type: 'string', default: 'publishedAt', label: 'Sort by', placeholder: 'publishedAt, relevancy, popularity' },
    maxItems: { type: 'number', default: 20, label: 'Max items' },
  },

  async fetch(config) {
    const apiKey = (config.apiKey as string) || '';
    if (!apiKey) throw new Error('NewsAPI key not configured.');

    const mode = (config.mode as string) || 'top-headlines';
    const params = new URLSearchParams();
    params.set('apiKey', apiKey);
    params.set('pageSize', '100');

    if (mode === 'top-headlines') {
      const country = (config.country as string) || 'us';
      const category = config.category as string;
      const q = config.query as string;

      params.set('country', country);
      if (category) params.set('category', category);
      if (q) params.set('q', q);

      const url = `${BASE_URL}/top-headlines?${params.toString()}`;
      const resp = await fetchWithCORS(url, apiKey);
      const data = await resp.json();

      if (data.status === 'error') {
        throw new Error(`NewsAPI error: ${data.message || data.code || 'unknown'}`);
      }

      const items: Array<Record<string, string>> = [];
      for (const article of data.articles || []) {
        if (!article.title) continue;
        const publishedAt = article.publishedAt || '';
        const desc = ((article.description || article.content || '').replace(/\[\+\d+ chars\]$/, '').trim());
        items.push({
          title: article.title,
          link: article.url || '',
          description: desc,
          image: article.urlToImage || '',
          source: article.source?.name || 'Unknown',
          author: article.author || '',
          pubDate: publishedAt,
        });
      }
      return { items };
    }

    // everything mode
    const q = (config.query as string) || '';
    if (!q) {
      // No query yet — return empty so the card shows "No data" instead of error
      return { items: [] };
    }

    const language = (config.language as string) || 'en';
    const sortBy = (config.sortBy as string) || 'publishedAt';

    params.set('q', q);
    params.set('language', language);
    params.set('sortBy', sortBy);

    const url = `${BASE_URL}/everything?${params.toString()}`;
    const resp = await fetchWithCORS(url, apiKey);
    const data = await resp.json();

    if (data.status === 'error') {
      throw new Error(`NewsAPI error: ${data.message || data.code || 'unknown'}`);
    }

    const items: Array<Record<string, string>> = [];
    for (const article of data.articles || []) {
      if (!article.title) continue;
      const publishedAt = article.publishedAt || '';
      const desc = ((article.description || article.content || '').replace(/\[\+\d+ chars\]$/, '').trim());
      items.push({
        title: article.title,
        link: article.url || '',
        description: desc,
        image: article.urlToImage || '',
        source: article.source?.name || 'Unknown',
        author: article.author || '',
        pubDate: publishedAt,
      });
    }
    return { items };
  },

  parse(raw, config) {
    const maxItems = Number(config.maxItems) || 20;
    const events: WatcherEvent[] = [];
    for (const item of raw.items.slice(0, maxItems)) {
      const cleanDesc = (item.description ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);

      const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

      events.push({
        id: `news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        watcherId: '',
        timestamp: pubDate,
        type: 'data',
        severity: 'info',
        payload: {
          title: item.title,
          link: item.link,
          description: cleanDesc,
          image: item.image || '',
          source: item.source || 'news',
          author: item.author || '',
        },
      });
    }
    return events;
  },
};
