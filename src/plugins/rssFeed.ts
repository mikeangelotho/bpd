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

function sanitizeHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractImage(entry: Element): string {
  // 1. <enclosure type="image/..."> (standard RSS)
  const enclosure = entry.querySelector('enclosure[type^="image"]');
  if (enclosure) {
    const url = enclosure.getAttribute('url') ?? '';
    if (url) return url;
  }

  // 2. <media:content medium="image"> (Media RSS)
  const mediaContent = entry.querySelector('media\\:content[medium="image"], content[medium="image"]');
  if (mediaContent) {
    const url = mediaContent.getAttribute('url') ?? '';
    if (url) return url;
  }

  // 3. <media:thumbnail>
  const mediaThumb = entry.querySelector('media\\:thumbnail, thumbnail');
  if (mediaThumb) {
    const url = mediaThumb.getAttribute('url') ?? '';
    if (url) return url;
  }

  // 4. <image> (RSS channel-level or item-level)
  const imgTag = entry.querySelector('image');
  if (imgTag) {
    const url = imgTag.getAttribute('url') ?? imgTag.querySelector('url')?.textContent ?? '';
    if (url) return url;
  }

  // 5. <img> inside description/content HTML
  const descEl = entry.querySelector('description')
    ?? entry.querySelector('summary')
    ?? entry.querySelector('content')
    ?? entry.querySelector('content\\:encoded');
  if (descEl) {
    const rawHtml = descEl.textContent ?? '';
    const imgMatch = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];
  }

  return '';
}

// ─── WIKIPEDIA IMAGE FALLBACK ───
// Resolves article titles to real editorial photos via Wikipedia's REST API.
// Results are cached so we only fetch once per unique topic.
const wikiImageCache = new Map<string, Promise<string>>();

function extractWikiQuery(title: string): string {
  // Strip common stop words and punctuation from titles to get searchable keywords
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'don', 'now', 'and', 'but',
    'or', 'if', 'because', 'until', 'while', 'about', 'against', 'that',
    'this', 'these', 'those', 'it', 'its', 'new', 'says', 'say', 'year',
    'years', 'man', 'men', 'woman', 'women', 'one', 'two', 'first', 'also',
  ]);

  // Take first 6 meaningful words from the title
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w))
    .slice(0, 6);

  return words.join(' ') || title.slice(0, 50);
}

export async function resolveWikiImage(title: string): Promise<string> {
  const query = extractWikiQuery(title);
  if (!query) return '';

  // Return cached result if available
  if (wikiImageCache.has(query)) {
    return wikiImageCache.get(query)!;
  }

  // Start the fetch and cache the promise
  const promise = (async (): Promise<string> => {
    try {
      // Search Wikipedia for matching pages
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
      const searchResp = await fetch(searchUrl);
      const searchData = await searchResp.json();

      if (!searchData.query?.search?.length) return '';

      // Get the top result's page ID and fetch its thumbnail
      const topResult = searchData.query.search[0];
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topResult.title)}`;
      const imgResp = await fetch(summaryUrl);
      const imgData = await imgResp.json();

      // Return the thumbnail URL if available
      return imgData.thumbnail?.source ?? '';
    } catch {
      return '';
    }
  })();

  wikiImageCache.set(query, promise);
  return promise;
}

// ─── RSS FEED WATCHER ───
export const rssFeedPlugin: WatcherPlugin<{ items: Array<Record<string, string>> }> = {
  id: 'rss-feed',
  name: 'RSS Feed',
  type: 'poll',
  defaultInterval: 300_000,
  configSchema: {
    url: { type: 'string', required: true, label: 'Feed URL', placeholder: 'https://...' },
    maxItems: { type: 'number', default: 20, label: 'Max items' },
  },

  async fetch(config) {
    const url = config.url as string;
    const resp = await fetchWithCORS(url);
    const text = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error(`RSS parse error: invalid XML from ${url}`);
    }

    const entries = doc.querySelectorAll('item, entry');

    if (entries.length === 0) {
      throw new Error(`No <item> or <entry> elements found in feed. Got ${text.slice(0, 200)}...`);
    }

    // Phase 1: extract all data + feed images (synchronous DOM parsing)
    interface RawEntry { title: string; link: string; description: string; feedImage: string; pubDate: string }
    const rawEntries: RawEntry[] = [];

    for (const entry of Array.from(entries)) {
      const title = sanitizeHtml(entry.querySelector('title')?.textContent ?? '');
      let link = '';
      const linkEl = entry.querySelector('link');
      if (linkEl) {
        link = linkEl.textContent?.trim() ?? linkEl.getAttribute('href') ?? '';
      }
      const descEl = entry.querySelector('description')
        ?? entry.querySelector('summary')
        ?? entry.querySelector('content')
        ?? entry.querySelector('content\\:encoded');

      const rawDesc = descEl?.textContent ?? '';
      const description = sanitizeHtml(rawDesc);
      const feedImage = extractImage(entry);
      const pubDate = entry.querySelector('pubDate, published, updated, dc\\:date')?.textContent ?? '';

      if (title) {
        rawEntries.push({ title, link, description, feedImage, pubDate });
      }
    }

    // Phase 2: resolve Wikipedia images in parallel for entries missing feed images
    const items: Array<Record<string, string>> = await Promise.all(
      rawEntries.map(async (raw) => {
        let image = raw.feedImage;
        if (!image && raw.title) {
          try {
            image = await resolveWikiImage(raw.title);
          } catch {
            // Wikipedia lookup failed — image stays empty
          }
        }
        return { title: raw.title, link: raw.link, description: raw.description, image: image || '', pubDate: raw.pubDate };
      })
    );

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

      events.push({
        id: `rss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        watcherId: '',
        timestamp: Date.now(),
        type: 'data',
        severity: 'info',
        payload: {
          title: item.title,
          link: item.link,
          description: cleanDesc,
          image: item.image || '',
          source: 'rss',
        },
      });
    }
    return events;
  },
};
