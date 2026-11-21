CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- Indexer: every contract event, keyed so a replay cannot double-count
CREATE TABLE IF NOT EXISTS ledger_events (
  id INTEGER PRIMARY KEY, block INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
  contract TEXT NOT NULL, event TEXT NOT NULL, args TEXT NOT NULL, ts INTEGER,
  UNIQUE (tx_hash, log_index));
CREATE INDEX IF NOT EXISTS ix_events_event ON ledger_events(contract, event);

-- The partner's own record: eINR moving in and out of the gateway (its "bank statement")
CREATE TABLE IF NOT EXISTS partner_bank_ledger (
  id INTEGER PRIMARY KEY, block INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), counterparty TEXT NOT NULL, amount_wei TEXT NOT NULL,
  UNIQUE (tx_hash, log_index));

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, block_number INTEGER NOT NULL,
  proposal_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, proposal_hash TEXT NOT NULL UNIQUE, snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL, signable INTEGER NOT NULL, violations_json TEXT NOT NULL,
  action TEXT, amount_wei TEXT, target TEXT, calldata TEXT, salt TEXT,
  model TEXT, meta_json TEXT, source TEXT NOT NULL DEFAULT 'agent');

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, uploaded_at TEXT NOT NULL, member_address TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  file_path TEXT NOT NULL, text TEXT, extraction_json TEXT, checks_json TEXT, guard_json TEXT,
  status TEXT NOT NULL, reason TEXT, invoice_hash TEXT, principal_wei TEXT, loan_id INTEGER, tx_hash TEXT);

CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT PRIMARY KEY, created_at TEXT NOT NULL, response_json TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS reconciler_runs (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, block INTEGER, ok INTEGER NOT NULL, details_json TEXT NOT NULL, pause_tx TEXT);

CREATE TABLE IF NOT EXISTS agent_requests (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT, status TEXT NOT NULL DEFAULT 'queued');
