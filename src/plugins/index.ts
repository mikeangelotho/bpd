import { registerPlugin } from '../engine/pluginRegistry';
import { rssFeedPlugin } from '../plugins/rssFeed';
import { tickerPlugin } from '../plugins/ticker';
import { urlScraperPlugin } from '../plugins/urlScraper';
import { demoPlugin } from '../plugins/demo';
import { newsApiPlugin } from '../plugins/newsApi';
import { trendingPlugin } from '../plugins/trending';
import { googleTrendsPlugin } from '../plugins/googleTrends';
import { adsbPlugin } from '../plugins/adsb';
import { weatherPlugin } from '../plugins/openMeteo';

/**
 * Register all built-in watcher plugins.
 * Call this once at app startup.
 */
export function registerBuiltinPlugins(): void {
  registerPlugin(rssFeedPlugin);
  registerPlugin(tickerPlugin);
  registerPlugin(urlScraperPlugin);
  registerPlugin(demoPlugin);
  registerPlugin(newsApiPlugin);
  registerPlugin(trendingPlugin);
  registerPlugin(googleTrendsPlugin);
  registerPlugin(adsbPlugin);
  registerPlugin(weatherPlugin);
}
