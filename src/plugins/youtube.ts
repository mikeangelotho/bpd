import type { WatcherPlugin, WatcherEvent } from '../types';
import { serverFetch } from '../lib/serverFetch';

// ─── YOUTUBE URL PARSING ───
// Accepts video and live *watch* URLs and normalizes them to an embeddable form.
// Supported: watch?v=ID, youtu.be/ID, /live/ID, /embed/ID, /shorts/ID, and a bare
// 11-char video ID. A start timestamp (?t= / ?start= / #t=) is carried through.

export interface ParsedYouTube {
  videoId: string;
  embedUrl: string;
  watchUrl: string;
  start?: number;
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

// Parse a "t" value like "1h2m3s", "90", or "90s" into whole seconds.
function parseStartSeconds(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!m) return undefined;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  const total = h * 3600 + min * 60 + s;
  return total > 0 ? total : undefined;
}

function extractVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const path = url.pathname;

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = path.split('/').filter(Boolean)[0] || '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  // youtube.com / youtube-nocookie.com / m.youtube.com
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    // /watch?v=<id>
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;

    // /live/<id>, /embed/<id>, /shorts/<id>, /v/<id>
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2 && ['live', 'embed', 'shorts', 'v'].includes(parts[0])) {
      const id = parts[1];
      return VIDEO_ID_RE.test(id) ? id : null;
    }
  }

  return null;
}

export function parseYouTubeUrl(input: string): ParsedYouTube {
  const raw = (input || '').trim();
  if (!raw) throw new Error('No YouTube URL provided.');

  // Bare video ID
  if (VIDEO_ID_RE.test(raw)) {
    return buildParsed(raw, undefined);
  }

  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(
      'Unrecognized YouTube link. Paste a video or live watch URL (watch?v=…, youtu.be/…, /live/…, /shorts/…).',
    );
  }

  // Timestamp from ?t= / ?start= / #t=
  const start =
    parseStartSeconds(url.searchParams.get('t')) ??
    parseStartSeconds(url.searchParams.get('start')) ??
    parseStartSeconds(url.hash ? url.hash.replace(/^#t=?/, '') : null);

  return buildParsed(videoId, start);
}

function buildParsed(videoId: string, start: number | undefined): ParsedYouTube {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (start && start > 0) params.set('start', String(start));

  return {
    videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    start,
  };
}

// ─── YOUTUBE PLAYER PLUGIN ───
// Renders an embedded YouTube player from a pasted link. No API key required; the
// iframe embed sidesteps CORS. Playback is click-to-play (poster until clicked).
// Live streams work through the same embed as any watch URL.
export const youtubePlugin: WatcherPlugin<{
  embedUrl: string;
  watchUrl: string;
  videoId: string;
  title?: string;
  author?: string;
  thumbnail?: string;
}> = {
  id: 'youtube',
  name: 'YouTube Player',
  type: 'poll',
  defaultInterval: 1_800_000, // 30 min — effectively "resolve once"; embeds self-update
  configSchema: {
    url: {
      type: 'string',
      required: true,
      label: 'YouTube URL',
      placeholder: 'https://youtube.com/watch?v=… , youtu.be/… , or a /live/… stream',
    },
  },

  async fetch(config) {
    const parsed = parseYouTubeUrl((config.url as string) || '');

    // Best-effort metadata via oEmbed (title/author/thumbnail). Never blocks playback.
    let title: string | undefined;
    let author: string | undefined;
    let thumbnail: string | undefined;
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.watchUrl)}&format=json`;
      const resp = await serverFetch(oembedUrl, { timeoutMs: 6000 });
      if (resp.ok) {
        const data = await resp.json();
        title = data.title;
        author = data.author_name;
        thumbnail = data.thumbnail_url;
      }
    } catch {
      // oEmbed unavailable (e.g. live/unlisted) — the player still works.
    }

    return {
      embedUrl: parsed.embedUrl,
      watchUrl: parsed.watchUrl,
      videoId: parsed.videoId,
      title,
      author,
      thumbnail,
    };
  },

  parse(raw) {
    const event: WatcherEvent = {
      id: `youtube-${raw.videoId}`,
      watcherId: '',
      timestamp: Date.now(),
      type: 'data',
      severity: 'info',
      payload: {
        source: 'youtube',
        embedUrl: raw.embedUrl,
        watchUrl: raw.watchUrl,
        videoId: raw.videoId,
        title: raw.title || '',
        author: raw.author || '',
        thumbnail: raw.thumbnail || '',
      },
    };
    return [event];
  },
};
