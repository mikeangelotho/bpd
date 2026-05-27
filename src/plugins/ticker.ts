import type { WatcherPlugin, WatcherEvent } from '../types';

interface TickerData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  marketCap?: string;
}

// ─── COINGECKO ID MAPPING ───
// CoinGecko uses full names, not ticker symbols. This maps common tickers to CG IDs.
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  SHIB: 'shiba-inu',
  LINK: 'chainlink',
  ATOM: 'cosmos',
  LTC: 'litecoin',
  UNI: 'uniswap',
  BCH: 'bitcoin-cash',
  NEAR: 'near',
  XLM: 'stellar',
  APE: 'apecoin',
  FIL: 'filecoin',
  ALGO: 'algorand',
  VET: 'vechain',
  ICP: 'internet-computer',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  SUI: 'sui',
  TON: 'the-open-network',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  INJ: 'injective-protocol',
  TIA: 'celestia',
  RENDER: 'render-token',
  FET: 'fetch-ai',
  IMX: 'immutable-x',
};

function resolveCoinGeckoId(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (COINGECKO_IDS[upper]) return COINGECKO_IDS[upper];
  // Fallback: try lowercase symbol directly (for less common coins)
  return symbol.toLowerCase();
}

// ─── COINGECKO RATE-LIMIT ERROR ───
// Custom error class so the scheduler can detect 429s and apply proper backoff
export class CoinGeckoRateLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CoinGeckoRateLimitError';
  }
}

// ─── CORS PROXY ───
const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];

async function fetchWithCORS(url: string): Promise<Response> {
  // Try direct fetch first — CoinGecko allows CORS
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) return resp;
    if (resp.status === 429) {
      throw new CoinGeckoRateLimitError(`CoinGecko rate limit (429). Cooldown required.`);
    }
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  } catch (e) {
    // Direct failed — try CORS proxies (but NOT for 429 — they'll also be rate-limited)
    if (e instanceof CoinGeckoRateLimitError) throw e;
    console.warn(`[ticker] Direct fetch failed, trying CORS proxies:`, e);
  }

  for (const proxy of CORS_PROXIES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(proxy + encodeURIComponent(url), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (resp.ok) return resp;
      if (resp.status === 429) {
        throw new CoinGeckoRateLimitError(`CoinGecko rate limit (429). Cooldown required.`);
      }
    } catch {
      continue;
    }
  }
  throw new Error(`All CORS proxies failed for ${url}`);
}

// ─── STOCK / CRYPTO TICKER WATCHER ───
export const tickerPlugin: WatcherPlugin<{ tickers: TickerData[] }> = {
  id: 'ticker',
  name: 'Stock / Crypto Ticker',
  type: 'poll',
  defaultInterval: 60_000, // 1 minute
  configSchema: {
    mode: { type: 'string', default: 'crypto', label: 'Mode', options: ['crypto', 'stocks', 'custom'] },
    symbols: { type: 'string', required: true, label: 'Symbols (comma-separated)', placeholder: 'BTC,ETH,SOL or AAPL,NVDA,TSLA' },
    apiUrl: { type: 'string', label: 'Custom API URL', placeholder: 'Only needed for stocks/custom mode' },
  },

  async fetch(config) {
    // Apply schema defaults (config from UI may not include default values)
    const schema = this.configSchema as Record<string, { default?: unknown }>;
    const merged: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema)) {
      merged[key] = (config[key] !== undefined && config[key] !== '') ? config[key] : field.default;
    }

    const mode = merged.mode as string;
    const symbolsRaw = merged.symbols as string | undefined;
    if (!symbolsRaw) throw new Error('No symbols configured. Enter ticker symbols (e.g., BTC,ETH,SOL).');
    const rawSymbols = symbolsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (rawSymbols.length === 0) throw new Error('No valid symbols. Enter at least one ticker (e.g., BTC).');

    if (mode === 'crypto') {
      // Map ticker symbols to CoinGecko IDs
      const ids = rawSymbols.map(resolveCoinGeckoId).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;

      console.log(`[ticker] Fetching: ${url}`);
      const resp = await fetchWithCORS(url);
      const data = await resp.json();
      console.log(`[ticker] CoinGecko response:`, JSON.stringify(data).slice(0, 300));

      const tickers: TickerData[] = [];
      for (const symbol of rawSymbols) {
        const cgId = resolveCoinGeckoId(symbol);
        const entry = data[cgId];
        if (entry) {
          tickers.push({
            symbol: symbol.toUpperCase(),
            price: entry.usd,
            change: entry.usd_24h_change ?? 0,
            changePercent: entry.usd_24h_change ?? 0,
            marketCap: entry.usd_market_cap ? formatMarketCap(entry.usd_market_cap) : undefined,
          });
        }
      }

      if (tickers.length === 0) {
        const availableKeys = Object.keys(data).join(', ');
        throw new Error(
          `No data for: ${rawSymbols.join(', ')}. CoinGecko returned: {${availableKeys}}. ` +
          `Use full CoinGecko IDs (e.g., 'solana' not 'sol') or common tickers (BTC, ETH, SOL).`
        );
      }

      return { tickers };
    }

    if (mode === 'custom' && config.apiUrl) {
      const resp = await fetch(config.apiUrl as string);
      if (!resp.ok) throw new Error(`Custom API fetch failed: ${resp.status}`);
      const data = await resp.json();
      const tickers: TickerData[] = Array.isArray(data) ? data : [data];
      return { tickers };
    }

    // stocks mode — needs a custom API (free stock APIs are rare)
    return { tickers: [] };
  },

  parse(raw, _config) {
    const events: WatcherEvent[] = [];
    for (const t of raw.tickers) {
      events.push({
        id: `ticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        watcherId: '',
        timestamp: Date.now(),
        type: 'data',
        severity: t.changePercent > 5 || t.changePercent < -5 ? 'warn' : 'info',
        payload: {
          symbol: t.symbol,
          price: `$${t.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          change: `${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(2)}%`,
          marketCap: t.marketCap,
          source: 'ticker',
        },
      });
    }
    return events;
  },
};

function formatMarketCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}
