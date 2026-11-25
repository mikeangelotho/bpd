# hub-server

Your **personal hub**: a local-first Bun server that owns your data and exposes the
MCP endpoint other agents (and your own) call. Local-first by design — no cloud, no
central database. See the product plan for the why; the MCP contract is in
[`../docs/mcp-contract.md`](../docs/mcp-contract.md).

## Run

```bash
bun run hub          # = bun run hub-server/server.ts
```

It prints your **self token** (the bearer secret your own agents use) and the MCP
endpoint. Env vars:

| var | default | meaning |
|---|---|---|
| `HUB_PORT` | `8787` | listen port |
| `HUB_DB` | `./hub.sqlite` | your data file (**this is your backup** — see below) |
| `HUB_HANDLE` | `@me` | your hub handle |

## Expose to the internet (Tailscale Funnel)

Manual for now (automation is a later milestone):

```bash
tailscale funnel <HUB_PORT>     # publishes over HTTPS at your *.ts.net hostname
```

Every request needs a capability token; untrusted writes land in **quarantine**, not
straight on your timeline. That's what makes an internet-facing personal endpoint safe.

## Call it

```bash
# your own agent leaving an alert on your timeline
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer $SELF_TOKEN" -H "Content-Type: application/json" \
  -d '{"tool":"post_alert","args":{"severity":"warn","title":"build failed","body":"main is red"}}'

# read your surfaced timeline
curl http://localhost:8787/api/timeline -H "Authorization: Bearer $SELF_TOKEN"
```

## Back up / restore (you own your data)

The entire hub is one SQLite file (`HUB_DB`). Back up by copying it; restore by
pointing `HUB_DB` at the copy. No export step, no vendor.

```bash
cp hub.sqlite hub-backup-$(date +%F).sqlite
```

## Test

```bash
bun test hub-server/
```

## Files

- `db.ts` — `bun:sqlite` store (timeline items, tokens, connections).
- `hub.ts` — request handler wiring `authorizeCall → ingestInboundWrite` (from
  `../src/hub/`) over HTTP, plus token auth + rate limiting.
- `server.ts` — `Bun.serve` entry point + self-token bootstrap.
