// ═══ HUB SERVER — ENTRY POINT ═══
//
// Runs the user's personal hub. Local-first: it owns a single SQLite file (the
// user-owned backup) and serves the MCP endpoint. Expose it to the internet with
// Tailscale Funnel (manual for now):
//
//   bun run hub-server/server.ts
//   tailscale funnel <HUB_PORT>            # publish over HTTPS at your *.ts.net host
//
// Env:
//   HUB_PORT    (default 8787)
//   HUB_DB      (default ./hub.sqlite)   — copy this file to back up your entire hub
//   HUB_HANDLE  (default @me)

import { createHub } from './hub';

const port = Number(process.env.HUB_PORT ?? 8787);
const hub = createHub({
  dbPath: process.env.HUB_DB ?? 'hub.sqlite',
  hubHandle: process.env.HUB_HANDLE ?? '@me',
  profile: { endpointUrl: `http://localhost:${port}/mcp` },
});

Bun.serve({ port, fetch: hub.handleRequest });

console.log(`\n  hub-server listening on http://localhost:${port}`);
console.log(`  MCP endpoint:  POST http://localhost:${port}/mcp`);
console.log(`  your self token (for your own agents):\n    ${hub.selfToken}`);
console.log(`\n  expose it:  tailscale funnel ${port}\n`);
