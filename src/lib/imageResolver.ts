// ─── IMAGE ENRICHMENT LAYER ───
// Resolves article images: feed → Wikipedia → gradient placeholder.
// All images are real photos, never AI-generated.

// ─── WIKIPEDIA IMAGE FALLBACK ───
// Uses Wikipedia's REST API to find real editorial photos for article topics.
// CORS-friendly, free, no API key needed.
const wikiImageCache = new Map<string, Promise<string>>();

function extractWikiQuery(title: string): string {
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
    'in', 'on', 'at', 'to', 'for', 'by', 'from', 'up', 'down', 'with',
  ]);

  // Extract meaningful keywords (first 4-5 content words)
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);

  return words.join(' ') || title.slice(0, 40);
}

export async function resolveWikiImage(title: string): Promise<string> {
  const query = extractWikiQuery(title);
  if (!query) return '';

  if (wikiImageCache.has(query)) {
    return wikiImageCache.get(query)!;
  }

  const promise = (async (): Promise<string> => {
    try {
      // Step 1: Search Wikipedia for matching pages
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
      const searchResp = await fetch(searchUrl);
      const searchData = await searchResp.json();

      if (!searchData.query?.search?.length) return '';

      // Step 2: Get the top result's thumbnail
      const topResult = searchData.query.search[0];
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topResult.title)}`;
      const imgResp = await fetch(summaryUrl);
      const imgData = await imgResp.json();

      return imgData.thumbnail?.source ?? '';
    } catch {
      return '';
    }
  })();

  wikiImageCache.set(query, promise);
  return promise;
}

// ─── GRADIENT PLACEHOLDER ───
// Clean, branded gradient fallback when no image is found.
// Uses the first letter of the title as a typographic mark.
const gradientHues = [200, 280, 340, 160, 30, 220, 300, 180, 45, 260];

function titleHash(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getPlaceholderGradient(title: string): string {
  const hue = gradientHues[titleHash(title) % gradientHues.length];
  return `linear-gradient(135deg, hsl(${hue}, 30%, 12%) 0%, hsl(${hue + 30}, 40%, 8%) 100%)`;
}

export function getPlaceholderLetter(title: string): string {
  // First letter, skipping leading articles/prepositions
  const skip = /^(a |an |the |and |but |or |for |so |yet |in |on |at |to )/i;
  const clean = title.replace(skip, '');
  return clean.charAt(0).toUpperCase() || '?';
}
