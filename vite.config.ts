import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import type { Plugin, Connect } from 'vite';

// ─── EXTERNAL AI QUERY ENDPOINT ───
// POST /api/ai/query — standalone server-side AI agent.
// Has its own tools that fetch data directly from APIs (CoinGecko, OpenSky, Open-Meteo).
// Independent of the browser app's state — always has fresh data.

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

export default defineConfig({
  plugins: [solid(), createAIMiddleware()],
  server: {
    port: 3000,
    proxy: {
      // Proxy OpenSky API requests to avoid CORS issues in dev
      '/api/opensky': {
        target: 'https://opensky-network.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/opensky/, '/api'),
      },
    },
  },
});
