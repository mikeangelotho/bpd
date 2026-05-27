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

// ─── REDDIT POST ───
interface RedditPost {
  title: string;
  url: string;
  subreddit: string;
  score: number;
  numComments: number;
  createdUtc: number;
  permalink: string;
  thumbnail: string | null;
  linkFlairText: string | null;
}

// ─── HN POST ───
interface HNPost {
  title: string;
  url: string | null;
  score: number;
  numComments: number;
  createdUtc: number;
  hnId: number;
}

// ─── TRENDING ITEM (unified) ───
export interface TrendingItem {
  title: string;
  url: string;
  source: string;        // subreddit name or "hacker-news"
  category: string;      // user-assigned category tag
  score: number;
  numComments: number;
  ageMinutes: number;
  velocity: number;       // score per hour
  thumbnail: string | null;
  flair: string | null;
}

// Parse a Reddit post from the JSON API
function parseRedditPost(post: any, subreddit: string): RedditPost | null {
  const d = post.data;
  if (!d || d.stickied) return null;

  const createdUtc = d.created_utc * 1000; // seconds → ms
  const ageMinutes = (Date.now() - createdUtc) / 60000;
  // Only show posts from the last 24 hours
  if (ageMinutes > 1440) return null;

  let thumbnail: string | null = null;
  if (d.thumbnail && d.thumbnail.startsWith('http')) {
    thumbnail = d.thumbnail;
  }

  return {
    title: d.title || '',
    url: d.url || `https://reddit.com${d.permalink}`,
    subreddit,
    score: d.score || 0,
    numComments: d.num_comments || 0,
    createdUtc,
    permalink: `https://reddit.com${d.permalink}`,
    thumbnail,
    linkFlairText: d.link_flair_text || null,
  };
}

// Parse an HN item
function parseHNPost(item: any): HNPost | null {
  if (!item || item.deleted || item.dead) return null;
  const createdUtc = (item.time || 0) * 1000;
  const ageMinutes = (Date.now() - createdUtc) / 60000;
  if (ageMinutes > 1440) return null;

  return {
    title: item.title || '',
    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
    score: item.score || 0,
    numComments: item.descendants || 0,
    createdUtc,
    hnId: item.id,
  };
}

// ─── TRENDING PLUGIN ───
export const trendingPlugin: WatcherPlugin<{ items: TrendingItem[] }> = {
  id: 'trending',
  name: 'Trending (Reddit + HN)',
  type: 'poll',
  defaultInterval: 120_000, // 2 minutes
  configSchema: {
    subreddits: {
      type: 'string',
      required: true,
      label: 'Subreddits (comma-separated)',
      placeholder: 'webdev,UI_Design,design,gardening,cars',
    },
    includeHN: { type: 'boolean', default: true, label: 'Include Hacker News' },
    maxItems: { type: 'number', default: 20, label: 'Max items' },
    minScore: { type: 'number', default: 5, label: 'Min score threshold' },
  },

  async fetch(config) {
    // Apply schema defaults
    const schema = this.configSchema as Record<string, { default?: unknown }>;
    const merged: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema)) {
      merged[key] = (config[key] !== undefined && config[key] !== '') ? config[key] : field.default;
    }

    const subredditsRaw = merged.subreddits as string | undefined;
    if (!subredditsRaw) throw new Error('No subreddits configured. Enter subreddit names (e.g., webdev,design).');
    const subreddits = subredditsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (subreddits.length === 0) throw new Error('No valid subreddit names.');

    const includeHN = !!merged.includeHN;
    const minScore = Number(merged.minScore) || 5;

    // Fetch Reddit posts from all subreddits in parallel
    const redditPromises = subreddits.map(async (sub) => {
      try {
        const url = `https://www.reddit.com/r/${sub}/rising.json?limit=25`;
        const resp = await fetchWithCORS(url);
        const data = await resp.json();
        const posts = (data.data?.children || [])
          .map((c: any) => parseRedditPost(c, sub))
          .filter(Boolean) as RedditPost[];
        return posts;
      } catch (e) {
        console.warn(`[trending] Failed to fetch r/${sub}:`, e);
        return [] as RedditPost[];
      }
    });

    // Fetch HN top stories
    const hnPromise = async (): Promise<HNPost[]> => {
      if (!includeHN) return [];
      try {
        // Get top story IDs
        const idsResp = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
        const ids: number[] = await idsResp.json();
        // Fetch details for top 30
        const topIds = ids.slice(0, 30);
        const itemPromises = topIds.map(async (id) => {
          try {
            const itemResp = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            const item = await itemResp.json();
            return parseHNPost(item);
          } catch {
            return null;
          }
        });
        const items = (await Promise.all(itemPromises)).filter(Boolean) as HNPost[];
        return items;
      } catch (e) {
        console.warn('[trending] Failed to fetch HN:', e);
        return [];
      }
    };

    const [redditPosts, hnPosts] = await Promise.all([
      Promise.all(redditPromises),
      hnPromise(),
    ]);

    const flatReddit = redditPosts.flat();

    // Convert to unified TrendingItem format
    const now = Date.now();
    const items: TrendingItem[] = [];

    for (const post of flatReddit) {
      if (post.score < minScore) continue;
      const ageHours = (now - post.createdUtc) / 3600000;
      const velocity = ageHours > 0 ? post.score / ageHours : post.score;
      items.push({
        title: post.title,
        url: post.permalink,
        source: `r/${post.subreddit}`,
        category: post.subreddit,
        score: post.score,
        numComments: post.numComments,
        ageMinutes: (now - post.createdUtc) / 60000,
        velocity,
        thumbnail: post.thumbnail,
        flair: post.linkFlairText,
      });
    }

    for (const post of hnPosts) {
      if (post.score < minScore) continue;
      const ageHours = (now - post.createdUtc) / 3600000;
      const velocity = ageHours > 0 ? post.score / ageHours : post.score;
      items.push({
        title: post.title,
        url: post.url || `https://news.ycombinator.com/item?id=${post.hnId}`,
        source: 'hacker-news',
        category: 'hacker-news',
        score: post.score,
        numComments: post.numComments,
        ageMinutes: (now - post.createdUtc) / 60000,
        velocity,
        thumbnail: null,
        flair: null,
      });
    }

    // Sort by velocity (highest momentum first)
    items.sort((a, b) => b.velocity - a.velocity);

    const maxItems = Number(merged.maxItems) || 20;
    return { items: items.slice(0, maxItems) };
  },

  parse(raw, config) {
    const events: WatcherEvent[] = [];
    for (const item of raw.items) {
      events.push({
        id: `trending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        watcherId: '',
        timestamp: Date.now(),
        type: 'data',
        severity: item.velocity > 50 ? 'warn' : 'info',
        payload: {
          title: item.title,
          link: item.url,
          source: item.source,
          category: item.category,
          score: item.score,
          comments: item.numComments,
          velocity: Math.round(item.velocity * 10) / 10,
          ageMinutes: Math.round(item.ageMinutes),
          thumbnail: item.thumbnail || '',
          flair: item.flair || '',
        },
      });
    }
    return events;
  },
};
