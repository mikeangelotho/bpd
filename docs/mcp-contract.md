# Personal Hub — MCP Endpoint Contract

Status: **draft / foundation.** This is the host-agnostic spec every hub implementation
(hosted Cloudflare Durable Object, self-hosted Node, …) and the SolidJS client agree on.
The authoritative types live in [`src/hub/contract.ts`](../src/hub/contract.ts); this
document is the prose companion. See the product outline in
`~/.claude/plans/this-is-a-situation-tingly-metcalfe.md` for the why.

---

## 1. Mental model

Each user *is* an addressable **MCP endpoint**. Their **timeline** is an agent-curated
inbox. Other people's agents call MCP **tools** against a hub to leave alerts, messages,
files, and reactions; the owner's own agent curates and triages what lands there.

- **Handle → hub.** A user picks a globally-unique `handle` (e.g. `@mike`) that resolves
  to a `HubProfile` with an `endpointUrl`.
- **Connection = capability.** Being connected means the owner has minted you a scoped,
  revocable **capability token**. No global write key exists.
- **Everything inbound is data.** Titles, bodies, notes, filenames from other agents are
  **inert content**, never instructions. Only the owner's own (`self`) actions drive the
  tool-calling agent. This is the one invariant the whole design protects.

---

## 2. Trust model

`OriginTrust`, ascending: `stranger` < `contact` < `self` (`TRUST_RANK`).

| Origin | Who | May do |
|---|---|---|
| `stranger` | no approved connection | `request_connection`, `get_profile` (discovery) |
| `contact` | approved, mutually connected | all writes + reads it's scoped for → **quarantined** |
| `self` | the owner's own agents/sessions | everything; may drive tool execution |

Trust decides **what a caller may do**. It does **not** make inbound content safe to
execute — even a `contact`'s message is inert data to the owner's agent.

---

## 3. Auth: capability tokens

`CapabilityToken` — minted per connection at the handshake, carrying:

- `scopes: CapabilityScope[]` — least-privilege (e.g. a contact who may message but not
  share files holds `timeline:send_message` but not `timeline:share_file`).
- `rateLimitPerHour`, optional `expiresAt`, and a `revoked` flag.

Revoking a contact revokes their token. Tokens are per-connection, never shared.

Scopes: `timeline:post_alert`, `timeline:send_message`, `timeline:share_file`,
`timeline:leave_reaction`, `timeline:read`, `profile:read`, `status:read`,
`connection:request`.

---

## 4. Tools (`HUB_TOOLS`)

Every call is gated by `authorizeCall(tool, auth)`: tool exists → caller meets
`minTrust` → token carries the tool's `scope`.

### Write tools

| Tool | minTrust | Effect |
|---|---|---|
| `post_alert(severity, title, body?, source?)` | `contact` | Alert item → **quarantine** |
| `send_message(text, attachmentIds?)` | `contact` | Message item → **quarantine** |
| `share_file(name, mime, size, url?)` | `contact` | File item; visible only after clean scan + quota check |
| `leave_reaction(targetId, emoji)` | `contact` | Reaction on an existing item |
| `request_connection(fromHandle, note?)` | `stranger` | Pending connection for the owner to approve/block — the **only** write a stranger may make |

### Read tools

| Tool | minTrust | Returns |
|---|---|---|
| `get_timeline(since?, limit?)` | `contact` | Permitted items, newest first |
| `get_profile()` | `stranger` | Public `HubProfile` (powers discovery) |
| `get_status()` | `contact` | Coarse presence/status per connection scope |

"Approved contacts only" (the locked product decision) = every write except
`request_connection` requires `minTrust: 'contact'`.

---

## 5. Timeline item envelope

All inbound writes normalize to `TimelineItem` — the same shape the app's existing
`WatcherEvent` uses (id/timestamp/severity/payload), plus **provenance** (`from`,
`originTrust`, `viaTokenId`) and **moderation** (`quarantined | approved | rejected`).
This lets outbound watcher events and inbound social items live in one feed.

`title`/`body`/`attachments`/`payload` are **untrusted** for any non-`self` origin.

`TriageMetadata` (optional, attached by the isolated triage pass) is **advisory only** —
`suggestedActions` are plain strings surfaced to the human, never executable tool calls.

---

## 6. The promotion pipeline (where safety is enforced)

```
inbound MCP call
   → authorizeCall()            (trust + scope; strangers rejected)
   → ingestInboundWrite()       (normalize → TimelineItem, moderation = 'quarantined')
   → [size/type limits] [content scan for files] [moderation]
   → triageUntrusted()          (ISOLATED, text-only LLM, advisory output, NO tools)
   → owner reviews / auto-promote per policy → moderation = 'approved' → visible
```

Two hard rules, enforced in [`src/hub/trustBoundary.ts`](../src/hub/trustBoundary.ts):

1. **Non-`self` content never enters the tool-calling agent as instructions.** It is
   wrapped by `renderUntrustedForAgent()` as clearly-delimited inert data.
2. **The triage path holds no tool executor.** `triageUntrusted()` accepts only a
   text-in/text-out LLM (`TextOnlyLLM`) and returns advisory metadata. There is no code
   path from untrusted ingest to a mutating tool. This is covered by
   `trustBoundary.test.ts` and that test **gates Phase 1**.

---

## 7. Open items (tracked in the plan)

- Backend stack confirmation (Cloudflare DO recommended).
- File content-scanning approach (`share_file`, Phase 3).
- Auto-promotion policy: which `contact` items skip manual review.
