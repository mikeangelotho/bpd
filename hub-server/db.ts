// ═══ HUB SERVER — LOCAL SQLITE STORE ═══
//
// The user's hub owns its data outright: a single `bun:sqlite` file that IS the
// backup (copy the file = full backup; point HUB_DB at it to restore). No cloud, no
// central database. Timeline items are stored losslessly as JSON with a few indexed
// columns for querying.

import { Database } from 'bun:sqlite';
import type {
  CapabilityScope,
  CapabilityToken,
  OriginTrust,
  TimelineItem,
} from '../src/hub/contract';

/** Every scope — granted to the owner's own (`self`) token. */
export const ALL_SCOPES: CapabilityScope[] = [
  'timeline:post_alert',
  'timeline:send_message',
  'timeline:share_file',
  'timeline:leave_reaction',
  'timeline:read',
  'profile:read',
  'status:read',
  'connection:request',
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS timeline_items (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  from_handle  TEXT NOT NULL,
  origin_trust TEXT NOT NULL,
  moderation   TEXT NOT NULL,
  json         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_created ON timeline_items(created_at);

CREATE TABLE IF NOT EXISTS tokens (
  id                  TEXT PRIMARY KEY,
  hub_handle          TEXT NOT NULL,
  issued_to           TEXT NOT NULL,
  origin_trust        TEXT NOT NULL,
  scopes              TEXT NOT NULL,     -- JSON array of CapabilityScope
  rate_limit_per_hour INTEGER NOT NULL,
  issued_at           INTEGER NOT NULL,
  expires_at          INTEGER,
  revoked             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS connections (
  handle       TEXT PRIMARY KEY,
  display_name TEXT,
  state        TEXT NOT NULL,
  token_id     TEXT,
  scopes       TEXT NOT NULL,            -- JSON array
  requested_at INTEGER NOT NULL,
  connected_at INTEGER,
  note         TEXT
);
`;

interface TokenRow {
  id: string;
  hub_handle: string;
  issued_to: string;
  origin_trust: string;
  scopes: string;
  rate_limit_per_hour: number;
  issued_at: number;
  expires_at: number | null;
  revoked: number;
}

function rowToToken(r: TokenRow): CapabilityToken {
  return {
    id: r.id,
    hubHandle: r.hub_handle,
    issuedTo: r.issued_to,
    originTrust: r.origin_trust as OriginTrust,
    scopes: JSON.parse(r.scopes) as CapabilityScope[],
    rateLimitPerHour: r.rate_limit_per_hour,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at ?? undefined,
    revoked: r.revoked === 1,
  };
}

export interface ListItemsOpts {
  since?: number;
  limit?: number;
  /** When false (default), only surfaced (`approved`) items are returned. */
  includeQuarantined?: boolean;
}

export class HubStore {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  // ─── timeline ───

  insertItem(item: TimelineItem): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO timeline_items
         (id, created_at, kind, from_handle, origin_trust, moderation, json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.createdAt,
        item.kind,
        item.from,
        item.originTrust,
        item.moderation,
        JSON.stringify(item),
      );
  }

  listItems(opts: ListItemsOpts = {}): TimelineItem[] {
    const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
    const since = Number(opts.since) || 0;
    const modClause = opts.includeQuarantined ? '' : `AND moderation = 'approved'`;
    const rows = this.db
      .query<{ json: string }, [number, number]>(
        `SELECT json FROM timeline_items
         WHERE created_at > ? ${modClause}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(since, limit);
    return rows.map((r) => JSON.parse(r.json) as TimelineItem);
  }

  setModeration(id: string, moderation: TimelineItem['moderation']): void {
    const row = this.db
      .query<{ json: string }, [string]>(`SELECT json FROM timeline_items WHERE id = ?`)
      .get(id);
    if (!row) return;
    const item = JSON.parse(row.json) as TimelineItem;
    item.moderation = moderation;
    this.insertItem(item);
  }

  // ─── tokens ───

  insertToken(token: CapabilityToken): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO tokens
         (id, hub_handle, issued_to, origin_trust, scopes, rate_limit_per_hour, issued_at, expires_at, revoked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token.id,
        token.hubHandle,
        token.issuedTo,
        token.originTrust,
        JSON.stringify(token.scopes),
        token.rateLimitPerHour,
        token.issuedAt,
        token.expiresAt ?? null,
        token.revoked ? 1 : 0,
      );
  }

  getToken(id: string): CapabilityToken | null {
    const row = this.db
      .query<TokenRow, [string]>(`SELECT * FROM tokens WHERE id = ?`)
      .get(id);
    return row ? rowToToken(row) : null;
  }

  revokeToken(id: string): void {
    this.db.query(`UPDATE tokens SET revoked = 1 WHERE id = ?`).run(id);
  }

  /**
   * Return the owner's own (`self`) token, creating one on first run. Its id doubles
   * as the bearer secret the owner's own agents authenticate with (printed at
   * startup). A production build should split id from secret; fine for the scaffold.
   */
  ensureSelfToken(hubHandle: string): CapabilityToken {
    const existing = this.db
      .query<TokenRow, []>(
        `SELECT * FROM tokens WHERE issued_to = 'self' AND revoked = 0 LIMIT 1`,
      )
      .get();
    if (existing) return rowToToken(existing);

    const token: CapabilityToken = {
      id: `tok_self_${crypto.randomUUID()}`,
      hubHandle,
      issuedTo: 'self',
      originTrust: 'self',
      scopes: ALL_SCOPES,
      rateLimitPerHour: 100_000,
      issuedAt: Date.now(),
      revoked: false,
    };
    this.insertToken(token);
    return token;
  }

  close(): void {
    this.db.close();
  }
}
