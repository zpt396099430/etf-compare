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

// ── helpers ───────────────────────────────────────────────────────────────────

function saveRecords(sessionId, source, data) {
  db.prepare('DELETE FROM records WHERE session_id=? AND source=?').run(sessionId, source);
  const ins = db.prepare(
    'INSERT INTO records (session_id, source, record_type, security_id, field_name, field_value) VALUES (?,?,?,?,?,?)'
  );
  const insertMany = db.transaction(rows => { for (const r of rows) ins.run(...r); });
  const rows = [];
  for (const [k, v] of Object.entries(data.headers)) rows.push([sessionId, source, 'header', null, k, v]);
  for (const [id, fields] of Object.entries(data.securities))
    for (const [k, v] of Object.entries(fields)) rows.push([sessionId, source, 'security', id, k, v]);
  insertMany(rows);
}

function loadData(sessionId, source) {
  const rows = db.prepare('SELECT * FROM records WHERE session_id=? AND source=?').all(sessionId, source);
  const headers = {}, securities = {};
  for (const r of rows) {
    if (r.record_type === 'header') headers[r.field_name] = r.field_value;
    else {
      if (!securities[r.security_id]) securities[r.security_id] = {};
      securities[r.security_id][r.field_name] = r.field_value;
    }
  }
  return { headers, securities };
}

function saveRawFile(sessionId, source, filename, mimeType, content) {
  db.prepare(
    'INSERT OR REPLACE INTO raw_files (session_id, source, filename, mime_type, content) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, source, filename, mimeType, content);
}

function getRawFile(sessionId, source) {
  return db.prepare('SELECT * FROM raw_files WHERE session_id=? AND source=?').get(sessionId, source);
}

function getMappings() {
  const rows = db.prepare('SELECT * FROM mappings').all();
  const result = {};
  for (const r of rows) {
    try { result[r.field_name] = JSON.parse(r.mapping_json); } catch {}
  }
  return result;
}

function bridgeDataForAC(data) {
  const bridged = {
    headers: { ...data.headers },
    securities: {}
  };

  for (const [id, fields] of Object.entries(data.securities || {})) {
    const next = { ...fields };
    if (next.SecurityIDSource == null && next.UnderlyingSecurityID != null) {
      next.SecurityIDSource = next.UnderlyingSecurityID;
    }
    bridged.securities[id] = next;
  }

  return bridged;
}

async function fetchAndSave(sessionId, fundCode, tradingDay) {
  const warnings = [];
  const cookie = await getCookie(fundCode);

  try {
    const xmlB = await downloadXML(fundCode, tradingDay, cookie);
    saveRawFile(sessionId, 'B', `download_${fundCode}_${tradingDay}.xml`, 'application/xml; charset=utf-8', xmlB);
    saveRecords(sessionId, 'B', parseXML(xmlB));
  } catch (e) {
    console.warn('下载文件(B)获取失败，跳过来源 B:', e.message);
    warnings.push(`下载文件(B)获取失败：${e.message}`);
  }

  try {
    const apiC = await fetchAPIData(fundCode, tradingDay, cookie);
    saveRawFile(sessionId, 'C', `afei_${fundCode}_${tradingDay}.json`, 'application/json; charset=utf-8', JSON.stringify(apiC, null, 2));
    saveRecords(sessionId, 'C', parseAPIData(apiC));
  } catch (e) {
    console.warn('阿飞 API 获取失败，跳过来源 C:', e.message);
    warnings.push(`阿飞文件(C)获取失败：${e.message}`);
  }

  return warnings;
}

// ── routes ────────────────────────────────────────────────────────────────────

// Upload 原始文件 → fetch 下载文件(B) + 阿飞文件(C)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const rawContent = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!rawContent.startsWith('<') || (!rawContent.includes('PortfolioCompositionFile') && !rawContent.includes('<PCFFile'))) {
    return res.status(400).json({ error: '上传文件不是可识别的 ETF 清单 XML' });
  }

  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run(sessionId, 'processing');
  res.json({ sessionId });

  ;(async () => {
    try {
      const dataA = parseXML(rawContent);
      if (!dataA.fundCode || !dataA.tradingDay) throw new Error('无法从文件中提取基金代码或交易日');
      db.prepare('UPDATE sessions SET fund_code=?, trading_day=? WHERE id=?').run(dataA.fundCode, dataA.tradingDay, sessionId);
      saveRawFile(sessionId, 'A', req.file.originalname || `upload_${dataA.fundCode}_${dataA.tradingDay}.xml`, req.file.mimetype || 'application/xml; charset=utf-8', rawContent);
      saveRecords(sessionId, 'A', dataA);
      const warnings = await fetchAndSave(sessionId, dataA.fundCode, dataA.tradingDay);
      db.prepare('UPDATE sessions SET status=?, error=? WHERE id=?').run('done', warnings.join('；') || null, sessionId);
    } catch (e) {
      console.error(e);
      db.prepare('UPDATE sessions SET status=?, error=? WHERE id=?').run('error', e.message, sessionId);
    }
  })();
});

// 重新获取网络数据并对比
app.post('/api/refresh/:id', async (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE sessions SET status=?, error=NULL WHERE id=?').run('processing', req.params.id);
  res.json({ ok: true });

  ;(async () => {
    try {
      const warnings = await fetchAndSave(session.id, session.fund_code, session.trading_day);
      db.prepare('UPDATE sessions SET status=?, error=? WHERE id=?').run('done', warnings.join('；') || null, session.id);
    } catch (e) {
      console.error(e);
      db.prepare('UPDATE sessions SET status=?, error=? WHERE id=?').run('error', e.message, session.id);
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
  const mappings = getMappings();
  const dataA = loadData(req.params.id, 'A');
  const dataB = loadData(req.params.id, 'B');
  const dataC = loadData(req.params.id, 'C');
  const dataAForAC = bridgeDataForAC(dataA);
  res.json({
    session,
    downloads: {
      A: !!getRawFile(req.params.id, 'A'),
      B: !!getRawFile(req.params.id, 'B'),
      C: !!getRawFile(req.params.id, 'C')
    },
    AB: compare(dataA, dataB, {}),            // 原始 vs 下载：无需桥接/映射
    AC: compare(dataAForAC, dataC, mappings)  // 原始 vs 阿飞：应用桥接和映射
  });
});

app.get('/api/download/:id/:source', (req, res) => {
  const source = String(req.params.source || '').toUpperCase();
  if (!['A', 'B', 'C'].includes(source)) return res.status(400).json({ error: 'Invalid source' });

  const file = getRawFile(req.params.id, source);
  if (!file) return res.status(404).json({ error: 'File not found' });

  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.send(file.content);
});

// List recent sessions
app.get('/api/sessions', (req, res) => {
  res.json(db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 20').all());
});

// Mappings CRUD
app.get('/api/mappings', (req, res) => {
  res.json(db.prepare('SELECT * FROM mappings').all());
});

app.post('/api/mappings', (req, res) => {
  const { field_name, mapping_json } = req.body;
  if (!field_name || !mapping_json) return res.status(400).json({ error: 'Missing fields' });
  try {
    JSON.parse(mapping_json);
    db.prepare('INSERT OR REPLACE INTO mappings (field_name, mapping_json) VALUES (?, ?)').run(field_name, mapping_json);
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'Invalid JSON' }); }
});

app.delete('/api/mappings/:field', (req, res) => {
  db.prepare('DELETE FROM mappings WHERE field_name=?').run(req.params.field);
  res.json({ ok: true });
});

// ── start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`ETF Compare running at http://localhost:${PORT}`);
  try { require('open')(`http://localhost:${PORT}`); } catch {}
});
