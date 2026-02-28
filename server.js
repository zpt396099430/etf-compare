const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { parseXML, parseAPIData } = require('./parser');
const { getCookie, downloadXML, fetchAPIData } = require('./fetcher');
const { compare } = require('./compare');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── helpers ──────────────────────────────────────────────────────────────────

function saveRecords(sessionId, source, data) {
  const ins = db.prepare(
    'INSERT INTO records (session_id, source, record_type, security_id, field_name, field_value) VALUES (?,?,?,?,?,?)'
  );
  const insertMany = db.transaction(rows => { for (const r of rows) ins.run(...r); });

  const rows = [];
  for (const [k, v] of Object.entries(data.headers)) {
    rows.push([sessionId, source, 'header', null, k, v]);
  }
  for (const [id, fields] of Object.entries(data.securities)) {
    for (const [k, v] of Object.entries(fields)) {
      rows.push([sessionId, source, 'security', id, k, v]);
    }
  }
  insertMany(rows);
}

function loadData(sessionId, source) {
  const rows = db.prepare('SELECT * FROM records WHERE session_id=? AND source=?').all(sessionId, source);
  const headers = {};
  const securities = {};
  for (const r of rows) {
    if (r.record_type === 'header') {
      headers[r.field_name] = r.field_value;
    } else {
      if (!securities[r.security_id]) securities[r.security_id] = {};
      securities[r.security_id][r.field_name] = r.field_value;
    }
  }
  return { headers, securities };
}

// ── routes ───────────────────────────────────────────────────────────────────

// Upload file A → trigger fetch B & C
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run(sessionId, 'processing');
  res.json({ sessionId });

  // Run async in background
  ;(async () => {
    try {
      // 1. Parse file A
      const dataA = parseXML(req.file.buffer.toString('utf8'));
      if (!dataA.fundCode || !dataA.tradingDay) throw new Error('Cannot extract fund code or trading day from file A');

      db.prepare('UPDATE sessions SET fund_code=?, trading_day=? WHERE id=?')
        .run(dataA.fundCode, dataA.tradingDay, sessionId);

      saveRecords(sessionId, 'A', dataA);

      // 2. Fetch cookie once
      const cookie = await getCookie(dataA.fundCode);

      // 3. Download XML (source B)
      const xmlB = await downloadXML(dataA.fundCode, dataA.tradingDay, cookie);
      const dataB = parseXML(xmlB);
      saveRecords(sessionId, 'B', dataB);

      // 4. Fetch API data (source C)
      const apiC = await fetchAPIData(dataA.fundCode, dataA.tradingDay, cookie);
      const dataC = parseAPIData(apiC);
      saveRecords(sessionId, 'C', dataC);

      db.prepare('UPDATE sessions SET status=? WHERE id=?').run('done', sessionId);
    } catch (e) {
      console.error(e);
      db.prepare('UPDATE sessions SET status=?, error=? WHERE id=?').run('error', e.message, sessionId);
    }
  })();
});

// Poll status
app.get('/api/status/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

// Get comparison results
app.get('/api/compare/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
  if (!session || session.status !== 'done') return res.status(400).json({ error: 'Not ready' });

  const dataA = loadData(req.params.id, 'A');
  const dataB = loadData(req.params.id, 'B');
  const dataC = loadData(req.params.id, 'C');

  res.json({
    session,
    AB: compare(dataA, dataB),
    AC: compare(dataA, dataC)
  });
});

// List recent sessions
app.get('/api/sessions', (req, res) => {
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 20').all();
  res.json(sessions);
});

// ── start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`ETF Compare running at http://localhost:${PORT}`);
  // Auto-open browser on Windows
  try { require('open')(`http://localhost:${PORT}`); } catch {}
});
