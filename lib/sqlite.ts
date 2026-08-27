// Zero-setup local database — node:sqlite (built into Node 22.5+) behind a
// tiny Supabase-compatible query shim, so the whole app runs with NO database
// account, NO SQL editor, NO keys. One file: ./data/starter.sqlite.
//
// The shim implements exactly the query surface this codebase uses:
//   from(t).select(cols).eq/.neq/.gte/.ilike/.in/.order/.limit/.single
//   from(t).insert(rows).select().single
//   from(t).upsert(rows, { onConflict })
//   from(t).update(patch).eq(...)
//   from(t).delete().eq(...)
//   from(t).select("id", { count: "exact", head: true })
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS thumb_library (
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, video_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '', channel_id TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0, published_at TEXT, length_seconds INTEGER,
  thumbnail_url TEXT NOT NULL DEFAULT '', outlier_ratio REAL, scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (topic, video_id)
);
CREATE TABLE IF NOT EXISTS watch_channels (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL DEFAULT (datetime('now')), last_scanned_at TEXT
);
CREATE TABLE IF NOT EXISTS watch_videos (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '', views INTEGER NOT NULL DEFAULT 0,
  published_at TEXT, thumbnail_url TEXT NOT NULL DEFAULT '', outlier_ratio REAL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS avatars (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, person TEXT NOT NULL DEFAULT 'me', image TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0, use_for_likeness INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', hook TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual',
  voice_transcript TEXT NOT NULL DEFAULT '', blueprint_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS video_hooks (
  video_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '',
  hook_text TEXT NOT NULL DEFAULT '', full_transcript TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS thumb_sessions (
  id TEXT PRIMARY KEY, instructions TEXT NOT NULL DEFAULT '', ref_images TEXT NOT NULL DEFAULT '[]',
  outputs TEXT NOT NULL DEFAULT '[]', took_ms INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS creator_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL DEFAULT '', one_liner TEXT NOT NULL DEFAULT '',
  business_model TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', pillars TEXT NOT NULL DEFAULT '',
  never_talk_about TEXT NOT NULL DEFAULT '', beliefs TEXT NOT NULL DEFAULT '', subreddits TEXT NOT NULL DEFAULT '',
  my_channel TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, angle TEXT NOT NULL DEFAULT '', why_you TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  beats TEXT NOT NULL DEFAULT '[]', source_refs TEXT NOT NULL DEFAULT '[]',
  uses INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS published_videos (
  id TEXT PRIMARY KEY, video_id TEXT NOT NULL UNIQUE, script_id TEXT, title TEXT NOT NULL DEFAULT '',
  published_at TEXT, views INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0, my_outlier REAL, thumbnail_url TEXT NOT NULL DEFAULT '',
  last_checked TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Columns stored as TEXT that Supabase would return as JSON / booleans.
const JSON_COLS: Record<string, string[]> = { thumb_sessions: ["ref_images", "outputs"], ideas: ["evidence"], blueprints: ["beats", "source_refs"] };
const BOOL_COLS: Record<string, string[]> = { avatars: ["is_default", "use_for_likeness"] };

let database: DatabaseSync | null = null;
function sqlite(): DatabaseSync {
  if (database) return database;
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  database = new DatabaseSync(path.join(dir, "starter.sqlite"));
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(SCHEMA);
  try { database.exec("ALTER TABLE scripts ADD COLUMN blueprint_id TEXT"); } catch { /* exists */ }
  return database;
}

type Row = Record<string, unknown>;
interface Result { data: Row[] | Row | null; error: { message: string } | null; count?: number }

function decode(table: string, row: Row): Row {
  const out: Row = { ...row };
  for (const c of JSON_COLS[table] || []) if (typeof out[c] === "string") { try { out[c] = JSON.parse(out[c] as string); } catch { /* keep */ } }
  for (const c of BOOL_COLS[table] || []) if (out[c] !== undefined) out[c] = Boolean(out[c]);
  return out;
}
function encode(table: string, row: Row): Row {
  const out: Row = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v !== null && typeof v === "object") out[k] = JSON.stringify(v);
    if (typeof v === "boolean") out[k] = v ? 1 : 0;
    if (v === undefined) delete out[k];
  }
  return out;
}

class Query implements PromiseLike<Result> {
  private wheres: { sql: string; val?: unknown; vals?: unknown[] }[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private wantSingle = false;
  private countOnly = false;
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private rows: Row[] = [];
  private patch: Row = {};
  private conflictCols = "";
  private returning = false;

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countOnly = true;
    if (this.op === "insert" || this.op === "upsert") this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) { this.op = "upsert"; this.rows = Array.isArray(rows) ? rows : [rows]; this.conflictCols = opts?.onConflict || "id"; return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: unknown) { this.wheres.push({ sql: `"${col}" = ?`, val }); return this; }
  neq(col: string, val: unknown) { this.wheres.push({ sql: `"${col}" != ?`, val }); return this; }
  gte(col: string, val: unknown) { this.wheres.push({ sql: `"${col}" >= ?`, val }); return this; }
  ilike(col: string, val: string) { this.wheres.push({ sql: `"${col}" LIKE ? COLLATE NOCASE`, val }); return this; }
  in(col: string, vals: unknown[]) { this.wheres.push({ sql: `"${col}" IN (${vals.map(() => "?").join(",") || "NULL"})`, vals }); return this; }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const dir = opts?.ascending === false ? "DESC" : "ASC";
    const nulls = opts?.nullsFirst === false || (opts?.ascending === false && opts?.nullsFirst !== true) ? `("${col}" IS NULL), ` : "";
    this.orders.push(`${nulls}"${col}" ${dir}`);
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.wantSingle = true; return this; }

  private run(): Result {
    const d = sqlite();
    const whereSql = this.wheres.length ? ` WHERE ${this.wheres.map((w) => w.sql).join(" AND ")}` : "";
    const whereVals = this.wheres.flatMap((w) => (w.vals ? w.vals : w.val !== undefined ? [w.val] : []));
    try {
      if (this.op === "select") {
        if (this.countOnly) {
          const r = d.prepare(`SELECT COUNT(*) AS c FROM "${this.table}"${whereSql}`).get(...(whereVals as never[])) as { c: number };
          return { data: null, error: null, count: Number(r.c) };
        }
        let sql = `SELECT * FROM "${this.table}"${whereSql}`;
        if (this.orders.length) sql += ` ORDER BY ${this.orders.join(", ")}`;
        if (this.limitN !== null) sql += ` LIMIT ${this.limitN}`;
        const rows = (d.prepare(sql).all(...(whereVals as never[])) as unknown as Row[]).map((r) => decode(this.table, r));
        if (this.wantSingle) return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } };
        return { data: rows, error: null };
      }
      if (this.op === "insert" || this.op === "upsert") {
        const inserted: Row[] = [];
        for (const raw of this.rows) {
          const row = encode(this.table, { ...raw });
          if (!("id" in row) && this.table !== "video_hooks" && this.table !== "creator_profile") row.id = randomUUID();
          const cols = Object.keys(row);
          const conflict = this.op === "upsert"
            ? ` ON CONFLICT (${this.conflictCols.split(",").map((c) => `"${c.trim()}"`).join(",")}) DO UPDATE SET ${cols.filter((c) => c !== "id").map((c) => `"${c}" = excluded."${c}"`).join(", ")}`
            : "";
          d.prepare(`INSERT INTO "${this.table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})${conflict}`)
            .run(...(cols.map((c) => row[c]) as never[]));
          inserted.push(decode(this.table, row));
        }
        const data = this.wantSingle ? inserted[0] || null : inserted;
        return { data, error: null };
      }
      if (this.op === "update") {
        const patch = encode(this.table, { ...this.patch });
        const cols = Object.keys(patch);
        if (!cols.length) return { data: null, error: null };
        d.prepare(`UPDATE "${this.table}" SET ${cols.map((c) => `"${c}" = ?`).join(", ")}${whereSql}`)
          .run(...([...cols.map((c) => patch[c]), ...whereVals] as never[]));
        return { data: null, error: null };
      }
      d.prepare(`DELETE FROM "${this.table}"${whereSql}`).run(...(whereVals as never[]));
      return { data: null, error: null };
    } catch (e) {
      return { data: this.wantSingle ? null : [], error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  then<A, B>(onOk?: ((v: Result) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onOk, onErr);
  }
}

export function sqliteDb() {
  return { from: (table: string) => new Query(table) };
}
