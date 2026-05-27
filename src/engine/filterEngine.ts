import type { WatcherEvent, SemanticFilter, FilterMatch } from '../types';

/**
 * Run a watcher event through all active semantic filters.
 * Returns matches where keywords or regex patterns hit the event payload.
 */
export function runFilterEngine(
  event: WatcherEvent,
  filters: SemanticFilter[]
): FilterMatch[] {
  const matches: FilterMatch[] = [];
  const searchable = extractSearchableText(event);

  for (const filter of filters) {
    const matchedKeywords: string[] = [];
    const matchedPatterns: string[] = [];

    // Keyword matching (case-insensitive)
    const lower = searchable.toLowerCase();
    for (const keyword of filter.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }

    // Regex matching
    for (const pattern of filter.regexPatterns) {
      try {
        const re = new RegExp(pattern, 'i');
        if (re.test(searchable)) {
          matchedPatterns.push(pattern);
        }
      } catch {
        // Skip invalid patterns
      }
    }

    if (matchedKeywords.length > 0 || matchedPatterns.length > 0) {
      matches.push({
        filter,
        event,
        matchedKeywords,
        matchedPatterns,
      });
    }
  }

  return matches;
}

/**
 * Extract all searchable text from a watcher event's payload.
 * Concatenates string values, ignores nested objects/arrays deeper than 1 level.
 */
function extractSearchableText(event: WatcherEvent): string {
  const parts: string[] = [];

  // Always include event type and watcher ID
  parts.push(event.type);
  parts.push(event.watcherId);

  // Flatten payload values
  const payload = event.payload;
  for (const key of Object.keys(payload)) {
    const val = payload[key];
    if (typeof val === 'string') {
      parts.push(val);
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      parts.push(String(val));
    } else if (Array.isArray(val)) {
      parts.push(val.filter((v) => typeof v === 'string').join(' '));
    }
  }

  return parts.join(' ');
}
