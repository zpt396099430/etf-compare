const Database = require('better-sqlite3');
const path = require('path');
const { DEFAULT_MAPPINGS } = require('./labels');

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
    source TEXT NOT NULL,
    record_type TEXT NOT NULL,
    security_id TEXT,
    field_name TEXT NOT NULL,
    field_value TEXT
  );

  CREATE TABLE IF NOT EXISTS mappings (
    field_name TEXT PRIMARY KEY,
    mapping_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id, source);
`);

// Insert default mappings if not exist
const insertMapping = db.prepare('INSERT OR IGNORE INTO mappings (field_name, mapping_json) VALUES (?, ?)');
const insertDefaults = db.transaction(() => {
  for (const [field, mapping] of Object.entries(DEFAULT_MAPPINGS)) {
    insertMapping.run(field, JSON.stringify(mapping));
  }
});
insertDefaults();

module.exports = db;
