const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'etf_compare.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    fund_code TEXT,
    trading_day TEXT,
    status TEXT DEFAULT 'processing',
    error TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    source TEXT NOT NULL,       -- 'A' | 'B' | 'C'
    record_type TEXT NOT NULL,  -- 'header' | 'security'
    security_id TEXT,           -- NULL for header rows
    field_name TEXT NOT NULL,
    field_value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id, source);
`);

module.exports = db;
