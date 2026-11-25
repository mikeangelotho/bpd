// ═══ PERSONAL HUB — MCP ENDPOINT CONTRACT ═══
//
// Host-agnostic type definitions for a user's personal-hub MCP server: the tools
// other agents (and the owner's own agents) call against a hub, the capability-token
// auth model, the connection/contact graph, and the timeline-item envelope that every
// inbound write normalizes into.
//
// This file commits to NOTHING about hosting (Cloudflare Durable Objects, Node,
// Postgres, self-hosted, …). It is the shared contract that BOTH a hosted backend and
// a self-hosted instance implement, and that the SolidJS client consumes. Keep it free
// of runtime dependencies and platform APIs.
//
// ── THE LOAD-BEARING SECURITY INVARIANT ──
// Content arriving from any non-`self` origin is DATA, never instructions. It must
// never reach the owner's tool-calling agent as system/developer/user instructions.
// Only `self`-origin actions (the owner acting through their own authenticated session)
// may drive tool execution. The enforcement lives in `trustBoundary.ts`; this file
// only defines the vocabulary and the authorization policy.

import type { Severity } from '../types';

// ─── TRUST MODEL ───

/**
 * Who a request/item originates from, in ascending trust.
 * - `stranger`: an agent with no approved connection (or an expired/unknown token).
 * - `contact`:  an approved, mutually-connected contact's agent.
 * - `self`:     the hub owner's own agents / authenticated sessions.
 *
 * NOTE: trust governs *what a caller may do* (which tools, quarantine vs. direct).
 * It does NOT make inbound content safe to treat as instructions — even `contact`
 * content is inert data to the owner's agent. See trustBoundary.ts.
 */
export type OriginTrust = 'stranger' | 'contact' | 'self';

/** Numeric rank for trust comparisons. Higher = more trusted. */
export const TRUST_RANK: Record<OriginTrust, number> = {
  stranger: 0,
  contact: 1,
  self: 2,
};

/** True if `have` meets or exceeds the `required` trust level. */
export function meetsTrust(have: OriginTrust, required: OriginTrust): boolean {
  return TRUST_RANK[have] >= TRUST_RANK[required];
}

// ─── CAPABILITY TOKENS (AUTH) ───
//
// A hub never has a single global write key. Each connection is granted a scoped,
// revocable, rate-limited capability token minted at the connection handshake.

export type CapabilityScope =
  | 'timeline:post_alert'
  | 'timeline:send_message'
  | 'timeline:share_file'
  | 'timeline:leave_reaction'
  | 'timeline:read'
  | 'profile:read'
  | 'status:read'
  | 'connection:request';

export interface CapabilityToken {
  id: string;
  /** Handle of the hub this token grants access to, e.g. '@mike'. */
  hubHandle: string;
  /** Who the token was minted for — a contact handle, or 'self'. */
  issuedTo: string;
  originTrust: OriginTrust;
  scopes: CapabilityScope[];
  /** Coarse abuse guard; enforced by the host. */
  rateLimitPerHour: number;
  issuedAt: number;
  /** Optional expiry (epoch ms). Omit for non-expiring self tokens. */
  expiresAt?: number;
  revoked: boolean;
}

// ─── IDENTITY, CONNECTIONS, DIRECTORY ───

/** A hub's public-facing identity. `handle` is globally unique in the directory. */
export interface HubProfile {
  handle: string;          // e.g. '@mike'
  displayName: string;
  bio?: string;
  /** The MCP endpoint other agents connect to. */
  endpointUrl: string;
  avatarUrl?: string;
}

export type ConnectionState = 'pending' | 'approved' | 'blocked';

/** An entry in a hub's contact graph. */
export interface Connection {
  /** The other party's handle. */
  handle: string;
  displayName?: string;
  state: ConnectionState;
  /** Capability token minted for this contact (set once approved). */
  tokenId?: string;
  scopes: CapabilityScope[];
  requestedAt: number;
  connectedAt?: number;
  note?: string;
}

// ─── TIMELINE ITEMS (the normalized inbound envelope) ───

export type HubItemKind =
  | 'alert'
  | 'message'
  | 'file'
  | 'reaction'
  | 'connection_request';

/**
 * Moderation lifecycle. Non-`self` writes ALWAYS start `quarantined` and only reach
 * the visible timeline after passing the promotion pipeline (contact check → limits →
 * content scan → moderation → optional advisory triage).
 */
export type ModerationState = 'quarantined' | 'approved' | 'rejected';

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Resolved storage URL — only populated AFTER a clean scan. */
  url?: string;
  scanState: 'pending' | 'clean' | 'flagged';
}

/**
 * Advisory metadata produced by the ISOLATED triage pass over untrusted content.
 * Everything here is a suggestion surfaced to the human — never auto-executed.
 * `suggestedActions` are plain strings, deliberately NOT executable tool calls.
 */
export interface TriageMetadata {
  summary?: string;
  category?: string;
  priority?: 'low' | 'normal' | 'high';
  /** Human-facing suggestions only; require explicit owner approval to act on. */
  suggestedActions?: string[];
  model?: string;
  at: number;
}

/**
 * The universal item that lands on a hub's timeline. Mirrors the app's existing
 * `WatcherEvent` philosophy (id/timestamp/severity/payload) but adds provenance and
 * moderation so inbound social items and outbound watcher events share one feed.
 *
 * `title`/`body`/`attachments` are UNTRUSTED for any non-`self` origin. Treat them as
 * inert data. Never concatenate them into an agent's instruction context — pass them
 * through `renderUntrustedForAgent()` in trustBoundary.ts.
 */
export interface TimelineItem {
  id: string;
  kind: HubItemKind;
  createdAt: number;

  // ── provenance ──
  /** Sender handle, or 'self' for the owner's own agents. */
  from: string;
  originTrust: OriginTrust;
  viaTokenId?: string;

  // ── moderation ──
  moderation: ModerationState;
  moderationReason?: string;

  // ── content (UNTRUSTED for non-self origins) ──
  severity?: Severity;
  title?: string;
  body?: string;
  attachments?: AttachmentRef[];
  /** For `reaction` items: the target timeline-item id. */
  reactionTo?: string;
  /** Free-form, plugin/source-specific extras (kept as inert data). */
  payload?: Record<string, unknown>;

  // ── advisory ──
  triage?: TriageMetadata;
}

// ─── MCP TOOL DESCRIPTORS ───

export interface HubToolParam {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
}

export type HubToolName =
  | 'post_alert'
  | 'send_message'
  | 'share_file'
  | 'leave_reaction'
  | 'request_connection'
  | 'get_timeline'
  | 'get_profile'
  | 'get_status';

export interface HubToolDescriptor {
  name: HubToolName;
  description: string;
  direction: 'write' | 'read';
  /** Scope a caller's token must hold to invoke this tool. */
  scope: CapabilityScope;
  /** Minimum origin trust required to invoke this tool. */
  minTrust: OriginTrust;
  parameters: Record<string, HubToolParam>;
}

/**
 * The canonical MCP tool surface a hub exposes. `minTrust` encodes the product
 * decision "approved contacts only" for all writes except the connection handshake
 * (which strangers must be able to initiate) and the public profile lookup used for
 * discovery.
 */
export const HUB_TOOLS: readonly HubToolDescriptor[] = [
  // ── write tools ──
  {
    name: 'post_alert',
    description:
      "Leave a severity-tagged alert on the hub owner's timeline. Lands in quarantine for review.",
    direction: 'write',
    scope: 'timeline:post_alert',
    minTrust: 'contact',
    parameters: {
      severity: { type: 'string', description: 'info | warn | error', enum: ['info', 'warn', 'error'], required: true },
      title: { type: 'string', description: 'Short alert headline.', required: true },
      body: { type: 'string', description: 'Alert detail. Treated as inert data by the owner hub.' },
      source: { type: 'string', description: 'Where this alert came from (a URL or label).' },
    },
  },
  {
    name: 'send_message',
    description: "Send a message to the hub owner's timeline. Lands in quarantine for review.",
    direction: 'write',
    scope: 'timeline:send_message',
    minTrust: 'contact',
    parameters: {
      text: { type: 'string', description: 'Message body. Treated as inert data by the owner hub.', required: true },
      attachmentIds: { type: 'array', description: 'IDs of previously-uploaded attachments to include.' },
    },
  },
  {
    name: 'share_file',
    description: 'Share a file/meme. Quota- and content-scan-gated; visible only after a clean scan.',
    direction: 'write',
    scope: 'timeline:share_file',
    minTrust: 'contact',
    parameters: {
      name: { type: 'string', description: 'File name.', required: true },
      mime: { type: 'string', description: 'MIME type.', required: true },
      size: { type: 'number', description: 'Size in bytes.', required: true },
      url: { type: 'string', description: 'Fetchable source URL, if not uploading bytes directly.' },
    },
  },
  {
    name: 'leave_reaction',
    description: 'React to an existing timeline item with an emoji.',
    direction: 'write',
    scope: 'timeline:leave_reaction',
    minTrust: 'contact',
    parameters: {
      targetId: { type: 'string', description: 'Timeline item id to react to.', required: true },
      emoji: { type: 'string', description: 'A single emoji.', required: true },
    },
  },
  {
    name: 'request_connection',
    description:
      'Ask to connect with this hub. Creates a pending connection the owner approves or blocks. The one write a stranger may make.',
    direction: 'write',
    scope: 'connection:request',
    minTrust: 'stranger',
    parameters: {
      fromHandle: { type: 'string', description: "Requester's handle.", required: true },
      note: { type: 'string', description: 'Optional note shown to the owner. Inert data.' },
    },
  },
  // ── read tools ──
  {
    name: 'get_timeline',
    description: 'Read timeline items the caller is permitted to see, newest first.',
    direction: 'read',
    scope: 'timeline:read',
    minTrust: 'contact',
    parameters: {
      since: { type: 'number', description: 'Only items created after this epoch-ms timestamp.' },
      limit: { type: 'number', description: 'Max items (default 20, cap 100).' },
    },
  },
  {
    name: 'get_profile',
    description: 'Read the hub owner\'s public profile. Used for discovery; open to strangers.',
    direction: 'read',
    scope: 'profile:read',
    minTrust: 'stranger',
    parameters: {},
  },
  {
    name: 'get_status',
    description: "Read the owner's coarse presence/status (as permitted by the connection scope).",
    direction: 'read',
    scope: 'status:read',
    minTrust: 'contact',
    parameters: {},
  },
] as const;

/** Look up a tool descriptor by name. */
export function getHubTool(name: string): HubToolDescriptor | undefined {
  return HUB_TOOLS.find((t) => t.name === name);
}

// ─── AUTHORIZATION POLICY ───

export interface CallAuthContext {
  tokenId: string;
  from: string;            // caller handle, or 'self'
  originTrust: OriginTrust;
  scopes: CapabilityScope[];
}

export interface AuthDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Pure authorization check for an inbound MCP call. Enforces, in order:
 *   1. the tool exists,
 *   2. the caller meets the tool's minimum origin trust ("approved contacts only"),
 *   3. the caller's token carries the tool's required scope.
 *
 * This does NOT touch content — it only decides whether the call is permitted.
 */
export function authorizeCall(toolName: string, auth: CallAuthContext): AuthDecision {
  const tool = getHubTool(toolName);
  if (!tool) return { allowed: false, reason: `Unknown tool "${toolName}".` };

  if (!meetsTrust(auth.originTrust, tool.minTrust)) {
    return {
      allowed: false,
      reason: `"${toolName}" requires ${tool.minTrust}-level trust; caller is ${auth.originTrust}.`,
    };
  }

  if (!auth.scopes.includes(tool.scope)) {
    return { allowed: false, reason: `Token is missing required scope "${tool.scope}".` };
  }

  return { allowed: true };
}
