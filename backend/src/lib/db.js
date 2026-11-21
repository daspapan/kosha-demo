// SQLite through Node's built-in node:sqlite (no native build step on a Mac).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "db", "schema.sql"), "utf8");

export function openDb(file, { readOnly = false } = {}) {
  if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { readOnly });
  if (!readOnly) {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.exec(SCHEMA);
  }
  return db;
}

export const meta = {
  get: (db, key) => db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value,
  set: (db, key, value) => db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value)),
};

export function tx(db, fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}

/** Every table except meta. Used by the demo reset. */
export function wipe(db) {
  for (const t of ["ledger_events", "partner_bank_ledger", "proposals", "invoices", "idempotency_keys", "reconciler_runs", "agent_requests"]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM meta WHERE key NOT IN ('demo_snapshot_id', 'chain_fingerprint')");
}
