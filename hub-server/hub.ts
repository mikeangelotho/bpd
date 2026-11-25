// ═══ HUB SERVER — REQUEST HANDLER ═══
//
// Wires the already-built, host-agnostic hub pipeline (src/hub/*) over HTTP:
//
//   POST /mcp            → authorizeCall → ingestInboundWrite → SQLite   (write tools)
//                        → authorizeCall → query                        (read tools)
//   GET  /api/timeline   → the owner's surfaced timeline (approved items)
//   GET  /api/health     → liveness
//
// Every request is authenticated by a capability token (Bearer). This is the
// internet-facing surface, so auth + rate-limit gate everything, and untrusted writes
// land in quarantine — never straight onto the visible timeline.

import {
  authorizeCall,
  getHubTool,
  type CallAuthContext,
  type HubProfile,
} from '../src/hub/contract';
import { ingestInboundWrite } from '../src/hub/trustBoundary';
import { HubStore } from './db';

export interface HubOptions {
  dbPath?: string;
  hubHandle?: string;
  profile?: Partial<HubProfile>;
}

export interface Hub {
  store: HubStore;
  handleRequest: (req: Request) => Promise<Response>;
  selfToken: string;
  close: () => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createHub(opts: HubOptions = {}): Hub {
  const hubHandle = opts.hubHandle ?? '@me';
  const store = new HubStore(opts.dbPath ?? 'hub.sqlite');
  const self = store.ensureSelfToken(hubHandle);

  const profile: HubProfile = {
    handle: hubHandle,
    displayName: opts.profile?.displayName ?? hubHandle,
    bio: opts.profile?.bio,
    endpointUrl: opts.profile?.endpointUrl ?? '',
    avatarUrl: opts.profile?.avatarUrl,
  };

  // ── simple in-memory per-token hourly rate limiter ──
  const hits = new Map<string, number[]>();
  function underRateLimit(tokenId: string, perHour: number): boolean {
    const now = Date.now();
    const windowStart = now - 3_600_000;
    const recent = (hits.get(tokenId) ?? []).filter((t) => t > windowStart);
    if (recent.length >= perHour) {
      hits.set(tokenId, recent);
      return false;
    }
    recent.push(now);
    hits.set(tokenId, recent);
    return true;
  }

  /** Resolve the Bearer capability token into an auth context, or null. */
  function resolveAuth(req: Request): CallAuthContext | null {
    const header = req.headers.get('authorization') ?? '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const token = store.getToken(m[1].trim());
    if (!token || token.revoked) return null;
    if (token.expiresAt && Date.now() > token.expiresAt) return null;
    return {
      tokenId: token.id,
      from: token.issuedTo,
      originTrust: token.originTrust,
      scopes: token.scopes,
    };
  }

  function handleRead(tool: string, args: Record<string, unknown>): Response {
    switch (tool) {
      case 'get_timeline':
        return json({
          items: store.listItems({ since: Number(args.since) || 0, limit: Number(args.limit) || 20 }),
        });
      case 'get_profile':
        return json({ profile });
      case 'get_status':
        return json({ status: 'ok' });
      default:
        return json({ error: `Unhandled read tool "${tool}".` }, 501);
    }
  }

  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, hub: hubHandle });
    }

    // ── the MCP call surface ──
    if (req.method === 'POST' && url.pathname === '/mcp') {
      const auth = resolveAuth(req);
      if (!auth) return json({ error: 'Missing or invalid capability token.' }, 401);

      const token = store.getToken(auth.tokenId)!;
      if (!underRateLimit(auth.tokenId, token.rateLimitPerHour)) {
        return json({ error: 'Rate limit exceeded.' }, 429);
      }

      let payload: { tool?: string; args?: Record<string, unknown> };
      try {
        payload = (await req.json()) as typeof payload;
      } catch {
        return json({ error: 'Invalid JSON body.' }, 400);
      }
      const tool = payload.tool;
      const args = payload.args ?? {};
      if (!tool) return json({ error: 'Missing "tool".' }, 400);

      const descriptor = getHubTool(tool);
      if (!descriptor) return json({ error: `Unknown tool "${tool}".` }, 404);

      if (descriptor.direction === 'read') {
        const decision = authorizeCall(tool, auth);
        if (!decision.allowed) return json({ error: decision.reason }, 403);
        return handleRead(tool, args);
      }

      // write tools: authorize + quarantine-ingest (authorizeCall runs inside ingest)
      const result = ingestInboundWrite({ tool, args, auth });
      if (!result.ok) return json({ error: result.rejectedReason }, 403);
      store.insertItem(result.item!);
      return json({ ok: true, item: result.item }, 201);
    }

    // ── convenience read for the local client (same auth as get_timeline) ──
    if (req.method === 'GET' && url.pathname === '/api/timeline') {
      const auth = resolveAuth(req);
      if (!auth) return json({ error: 'Missing or invalid capability token.' }, 401);
      const decision = authorizeCall('get_timeline', auth);
      if (!decision.allowed) return json({ error: decision.reason }, 403);
      return json({ items: store.listItems({ since: Number(url.searchParams.get('since')) || 0 }) });
    }

    return json({ error: 'Not found.' }, 404);
  }

  return { store, handleRequest, selfToken: self.id, close: () => store.close() };
}
