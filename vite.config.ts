import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import type { Plugin } from 'vite';

// ─── EXTERNAL AI QUERY ENDPOINT ───
// POST /api/ai/query — standalone server-side AI agent.
// Has its own tools that fetch data directly from APIs (CoinGecko, OpenSky, Open-Meteo).
// Independent of the browser app's state — always has fresh data.

// ─── GENERIC SERVER-SIDE FETCH PROXY ───
// GET /api/fetch?url=<encoded> — fetches an arbitrary http(s) URL server-side and
// streams the response back to the browser. Runs in Node, so there are no CORS or
// mixed-content restrictions. This replaces the flaky public CORS proxies the plugins
// used to depend on (allorigins.win / corsproxy.io / codetabs).
//
// A normal browser User-Agent is sent so sources that block bot/proxy traffic (e.g.
// Reddit's *.json endpoints, which 403 datacenter IPs) respond normally.
function createFetchProxyMiddleware(): Plugin {
  const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

  return {
    name: 'bpd-fetch-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/fetch')) return next();

        // Always allow same-origin browser calls.
        const respondError = (status: number, message: string) => {
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify({ error: message }));
        };

        let target: URL;
        try {
          const parsed = new URL(req.url, 'http://localhost');
          const raw = parsed.searchParams.get('url');
          if (!raw) return respondError(400, 'Missing ?url= parameter');
          target = new URL(raw);
        } catch {
          return respondError(400, 'Invalid ?url= parameter');
        }

        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          return respondError(400, `Unsupported protocol: ${target.protocol}`);
        }

        // Forward optional headers passed as x-proxy-header-<name>. Send a realistic
        // browser header set — some sources (e.g. Reddit) 403 requests missing Accept.
        const forwardHeaders: Record<string, string> = {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        };
        for (const [key, value] of Object.entries(req.headers)) {
          if (key.startsWith('x-proxy-header-') && typeof value === 'string') {
            forwardHeaders[key.slice('x-proxy-header-'.length)] = value;
          }
        }

        try {
          const upstream = await fetch(target.toString(), {
            method: 'GET',
            headers: forwardHeaders,
            signal: AbortSignal.timeout(15000),
          });

          const body = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          });
          res.end(body);
        } catch (err) {
          respondError(502, `Upstream fetch failed: ${String(err)}`);
        }
      });
    },
  };
}

function createAIMiddleware(): Plugin {
  // Resolve model once at startup
  let resolvedModel = 'llama3.2';
  (async () => {
    try {
      const resp = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.models || []).map((m: any) => m.name);
        if (models.length > 0) {
          resolvedModel = models.find((m: string) => m.includes('qwen') || m.includes('granite') || m.includes('llama')) || models[0];
          console.log(`[bpd-ai-middleware] Discovered ${models.length} models, defaulting to: ${resolvedModel}`);
        }
      }
    } catch {
      console.warn('[bpd-ai-middleware] Could not reach Ollama at startup, fallback:', resolvedModel);
    }
  })();

  return {
    name: 'bpd-ai-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Only handle POST /api/ai/query
        if (req.method !== 'POST' || !req.url?.startsWith('/api/ai')) {
          return next();
        }

        // Parse the request body
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            const message = parsed.message || parsed.query || '';
            const model = parsed.model || resolvedModel;

            if (!message) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing message/query field' }));
              return;
            }

            // Call Ollama directly with server-side tools context
            const result = await handleAIQuery(message, model);

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

/** Handle an AI query with server-side data fetching */
async function handleAIQuery(message: string, model: string): Promise<unknown> {
  const start = Date.now();

  // Pre-fetch current data to inject as context
  const context = await buildServerContext();

  // Call Ollama
  const ollamaResp = await callOllama(message, model, context);

  return {
    response: ollamaResp,
    processingTime: Date.now() - start,
    model,
    context: {
      watchers: context.watchers,
      alerts: context.alerts,
      timestamp: new Date().toISOString(),
    },
  };
}

/** Build a snapshot of current data from all sources */
async function buildServerContext(): Promise<{
  watchers: string;
  alerts: string;
}> {
  const results: string[] = [];

  // Fetch crypto prices
  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
    if (resp.ok) {
      const data = await resp.json();
      results.push(`Crypto: ${JSON.stringify(data)}`);
    }
  } catch {
    results.push('Crypto: fetch failed');
  }

  // Fetch weather (NYC default)
  try {
    const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current_weather=true&timezone=auto');
    if (resp.ok) {
      const data = await resp.json();
      results.push(`Weather (NYC): ${JSON.stringify(data.current_weather)}`);
    }
  } catch {
    results.push('Weather: fetch failed');
  }

  // Fetch flight data (NYC area, small bbox)
  try {
    const resp = await fetch('https://opensky-network.org/api/states/all?lamin=40.2&lomin=-74.5&lamax=41.2&lomax=-73.5');
    if (resp.ok) {
      const data = await resp.json();
      const count = data.states?.length || 0;
      results.push(`Flights (NYC area): ${count} aircraft`);
    }
  } catch {
    results.push('Flights: fetch failed');
  }

  return {
    watchers: results.join('\n'),
    alerts: 'No active alerts (server-side view)',
  };
}

/** Call Ollama with context and tool-like system prompt */
async function callOllama(
  message: string,
  model: string,
  context: { watchers: string; alerts: string },
): Promise<string> {
  const systemPrompt = `You are BPD (Bippy Dashboard), an AI assistant for a real-time signal monitoring dashboard.

## CRITICAL RULES
- NEVER fabricate, invent, or guess data. Only report what you see in the context below.
- If the context shows stale/missing data, say so explicitly. Do NOT fill in gaps.
- All data shown is from the last fetch — reference timestamps when available.
- If asked about something not in the context, say "I don't have current data for that."

## Current Dashboard Data
${context.watchers}

## Alerts
${context.alerts}

## Your Role
- Answer questions about the current dashboard state using ONLY the data above
- Be concise and data-driven
- If asked to perform actions (add watchers, etc.), explain what would happen but note that action tools are only available in the browser app
- Current time: ${new Date().toISOString()}`;

  try {
    const resp = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        stream: false,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return `Ollama error (HTTP ${resp.status}): ${text}`;
    }

    const data = await resp.json();
    return data.message?.content || '(empty response)';
  } catch (err) {
    return `Failed to reach Ollama at localhost:11434. Is it running? Error: ${String(err)}`;
  }
}

// ─── REDDIT OAUTH PROXY ───
// GET /api/reddit?sub=<name>&sort=rising&limit=25
// Reddit blocks unauthenticated .json requests from server/proxy IPs with a 403 wall.
// This endpoint uses app-only OAuth (client_credentials) so the browser never sees the
// secret and requests hit oauth.reddit.com with a bearer token. Configure via env:
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET  (from https://www.reddit.com/prefs/apps — "script" app)
//   REDDIT_USER_AGENT  (optional; Reddit requires a descriptive UA)
function createRedditMiddleware(env: Record<string, string>): Plugin {
  const clientId = env.REDDIT_CLIENT_ID || '';
  const clientSecret = env.REDDIT_CLIENT_SECRET || '';
  const userAgent = env.REDDIT_USER_AGENT || 'web:bpd-situation-monitor:v0.1 (by /u/bpd)';

  // Cache the app-only token in module scope; refresh a minute before expiry.
  let cached: { token: string; expiresAt: number } | null = null;

  async function getToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      throw new Error(`Reddit token HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const data = await resp.json();
    cached = {
      token: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    return cached.token;
  }

  return {
    name: 'bpd-reddit',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/reddit')) return next();

        const send = (status: number, obj: unknown) => {
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify(obj));
        };

        if (!clientId || !clientSecret) {
          return send(501, {
            error: 'Reddit OAuth not configured. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env.',
          });
        }

        let params: URLSearchParams;
        try {
          params = new URL(req.url, 'http://localhost').searchParams;
        } catch {
          return send(400, { error: 'Invalid request URL' });
        }

        const sub = (params.get('sub') || '').replace(/[^a-zA-Z0-9_]/g, '');
        const sort = (params.get('sort') || 'rising').replace(/[^a-z]/g, '');
        const limit = Math.min(Number(params.get('limit')) || 25, 100);
        if (!sub) return send(400, { error: 'Missing ?sub= parameter' });

        try {
          const token = await getToken();
          const upstream = await fetch(
            `https://oauth.reddit.com/r/${sub}/${sort}?limit=${limit}&raw_json=1`,
            {
              headers: { Authorization: `bearer ${token}`, 'User-Agent': userAgent },
              signal: AbortSignal.timeout(12000),
            },
          );
          const body = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          });
          res.end(body);
        } catch (err) {
          send(502, { error: `Reddit fetch failed: ${String(err)}` });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load .env (and process.env) so server middlewares can read secrets like the
  // Reddit OAuth credentials. The '' prefix loads all vars, not just VITE_*.
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [solid(), createFetchProxyMiddleware(), createRedditMiddleware(env), createAIMiddleware()],
  server: {
    // Allow the tailnet host plus localhost / any *.ts.net host so the app loads
    // however it's reached (direct localhost or via Tailscale serve over HTTPS).
    allowedHosts: [
        "bippy.tail44eee4.ts.net",
        ".ts.net",
        "localhost",
    ],
    port: 3000,
    proxy: {
      // Proxy OpenSky API requests to avoid CORS issues in dev
      '/api/opensky': {
        target: 'https://opensky-network.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/opensky/, '/api'),
      },
      // Same-origin proxy to the local Ollama server. This lets the browser reach
      // Ollama over HTTPS (via Tailscale) without mixed-content blocking, while the
      // tool-calling agent loop stays client-side (its tools need the live store).
      '/api/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
      },
    },
  },
  };
});
