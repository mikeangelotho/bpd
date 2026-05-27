import type { WatcherPlugin, WatcherEvent } from '../types';

// ─── DEMO WATCHER ───
// Generates realistic fake data for UI testing without external APIs
export const demoPlugin: WatcherPlugin<Record<string, unknown>> = {
  id: 'demo',
  name: 'Demo (Mock Data)',
  type: 'poll',
  defaultInterval: 10_000, // 10 seconds
  configSchema: {
    scenario: { type: 'string', default: 'mixed', label: 'Scenario', options: ['mixed', 'tech-news', 'crypto', 'alerts'] },
  },

  async fetch(config) {
    const scenario = (config.scenario as string) || 'mixed';
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700)); // simulate latency

    const now = Date.now();
    const payloads: Record<string, unknown>[] = [];

    const techNews = [
      { title: 'SolidJS 1.9.4 released with improved reactivity', source: 'Hacker News' },
      { title: 'New AI agent framework drops, claims 10x throughput', source: 'TechCrunch' },
      { title: 'WebGPU standard finalized — browsers race to implement', source: 'The Verge' },
      { title: 'Vite 7 roadmap announced, build times cut in half', source: 'Dev.to' },
      { title: 'Rust + WASM: 2025 benchmark results surprise everyone', source: 'Lobsters' },
    ];

    const cryptoData = [
      { symbol: 'BTC', price: 104_230 + Math.random() * 500, change: (Math.random() - 0.5) * 4 },
      { symbol: 'ETH', price: 2_540 + Math.random() * 100, change: (Math.random() - 0.5) * 6 },
      { symbol: 'SOL', price: 172 + Math.random() * 10, change: (Math.random() - 0.5) * 8 },
    ];

    const alerts = [
      { message: 'CVE-2025-31842: Critical RCE in Express.js', severity: 'error' },
      { message: 'Competitor A raised prices 12%', severity: 'warn' },
      { message: 'Sentiment spike detected: +18% in last hour', severity: 'info' },
      { message: 'Flight deal: NYC → TYO $420 RT', severity: 'info' },
      { message: 'GitHub security advisory: npm package compromised', severity: 'error' },
    ];

    switch (scenario) {
      case 'tech-news':
        for (const item of techNews.slice(0, 3)) {
          payloads.push({ ...item, source: 'demo-tech', type: 'news' });
        }
        break;
      case 'crypto':
        for (const c of cryptoData) {
          payloads.push({
            symbol: c.symbol,
            price: `$${c.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
            change: `${c.change >= 0 ? '+' : ''}${c.change.toFixed(2)}%`,
            source: 'demo-crypto',
            type: 'ticker',
          });
        }
        break;
      case 'alerts':
        for (const a of alerts.slice(0, 3)) {
          payloads.push({ ...a, source: 'demo-alerts', type: 'alert' });
        }
        break;
      default: // mixed
        payloads.push({ ...techNews[0], source: 'demo-mixed', type: 'news' });
        const c = cryptoData[Math.floor(Math.random() * cryptoData.length)];
        payloads.push({
          symbol: c.symbol,
          price: `$${c.price.toFixed(2)}`,
          change: `${c.change >= 0 ? '+' : ''}${c.change.toFixed(2)}%`,
          source: 'demo-mixed',
          type: 'ticker',
        });
        payloads.push({ ...alerts[Math.floor(Math.random() * alerts.length)], source: 'demo-mixed', type: 'alert' });
    }

    return { payloads, scenario };
  },

  parse(raw) {
    const events: WatcherEvent[] = [];
    for (const payload of raw.payloads as Record<string, unknown>[]) {
      events.push({
        id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        watcherId: '',
        timestamp: Date.now(),
        type: (payload.type as 'data' | 'alert' | 'error') || 'data',
        severity: (payload.severity as 'info' | 'warn' | 'error') || 'info',
        payload,
      });
    }
    return events;
  },
};
