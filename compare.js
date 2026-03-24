const { FIELD_LABELS, SECURITY_DISPLAY_FIELDS } = require('./labels');

function normalizeVal(v) {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v).trim();
  if (!s) return '';

  if (s.endsWith('%')) {
    const n = parseFloat(s);
    if (!isNaN(n)) return String(n / 100);
  }

  const lowered = s.toLowerCase();
  if (['是', 'y', 'yes', 'true'].includes(lowered)) return '1';
  if (['否', 'n', 'no', 'false'].includes(lowered)) return '0';

  const n = parseFloat(s);
  if (!isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return String(n);
  return lowered;
}

function compare(dataA, dataB, mappings = {}) {
  function applyMapping(field, value) {
    if (value === null || value === undefined) return value;
    const m = mappings[field];
    if (m) return m[String(value)] ?? value;
    return value;
  }

  const allHeaderKeys = new Set([...Object.keys(dataA.headers), ...Object.keys(dataB.headers)]);
  const headerRows = [];
  for (const field of allHeaderKeys) {
    const rawA = dataA.headers[field] ?? null;
    const rawB = dataB.headers[field] ?? null;
    const mappedA = applyMapping(field, rawA);
    const diff = normalizeVal(mappedA) !== normalizeVal(rawB);
    headerRows.push({ field, labelCN: FIELD_LABELS[field] || field, valueA: rawA, valueB: rawB, diff });
  }

  const allIds = new Set([...Object.keys(dataA.securities), ...Object.keys(dataB.securities)]);
  const securityRows = [];

  for (const id of allIds) {
    const secA = dataA.securities[id];
    const secB = dataB.securities[id];

    if (!secA) {
      securityRows.push({ id, name: secB.InstrumentName || id, onlyIn: 'B', hasDiff: true, fields: buildFields(null, secB, mappings) });
      continue;
    }
    if (!secB) {
      securityRows.push({ id, name: secA.InstrumentName || id, onlyIn: 'A', hasDiff: true, fields: buildFields(secA, null, mappings) });
      continue;
    }

    const fields = buildFields(secA, secB, mappings);
    const hasDiff = Object.values(fields).some(f => f.diff);
    securityRows.push({ id, name: secA.InstrumentName || secB.InstrumentName || id, onlyIn: null, hasDiff, fields });
  }

  for (const row of securityRows) row.merged = buildMergedDisplay(row);

  securityRows.sort((a, b) => {
    if (a.onlyIn && !b.onlyIn) return -1;
    if (!a.onlyIn && b.onlyIn) return 1;
    if (a.hasDiff && !b.hasDiff) return -1;
    if (!a.hasDiff && b.hasDiff) return 1;
    return a.id.localeCompare(b.id);
  });

  const stats = {
    headerDiffs: headerRows.filter(r => r.diff).length,
    securityDiffs: securityRows.filter(r => !r.onlyIn && r.hasDiff).length,
    onlyInA: securityRows.filter(r => r.onlyIn === 'A').length,
    onlyInB: securityRows.filter(r => r.onlyIn === 'B').length,
  };

  return { headerRows, securityRows, stats, securityFields: SECURITY_DISPLAY_FIELDS, fieldLabels: FIELD_LABELS };
}

function buildMergedDisplay(row) {
  const merged = {};
  for (const [f, v] of Object.entries(row.fields)) {
    if (row.onlyIn === 'A') {
      merged[f] = v.valueA != null ? String(v.valueA) : '—';
    } else if (row.onlyIn === 'B') {
      merged[f] = v.valueB != null ? String(v.valueB) : '—';
    } else if (v.diff) {
      const a = v.valueA != null ? String(v.valueA) : '—';
      const b = v.valueB != null ? String(v.valueB) : '—';
      merged[f] = a + '<span style="color:#f56c6c;font-size:12px">（' + b + '）</span>';
    } else {
      merged[f] = v.valueA != null ? String(v.valueA) : '—';
    }
  }
  return merged;
}

function buildFields(secA, secB, mappings) {
  const allFields = new Set([
    ...(secA ? Object.keys(secA) : []),
    ...(secB ? Object.keys(secB) : [])
  ]);
  const fields = {};
  for (const f of allFields) {
    const rawA = secA ? (secA[f] ?? null) : null;
    const rawB = secB ? (secB[f] ?? null) : null;
    const mappedA = applyMappingStatic(mappings, f, rawA);
    const diff = normalizeVal(mappedA) !== normalizeVal(rawB);
    fields[f] = { valueA: rawA, valueB: rawB, diff };
  }
  return fields;
}

function applyMappingStatic(mappings, field, value) {
  if (value === null || value === undefined) return value;
  const m = mappings[field];
  if (m) return m[String(value)] ?? value;
  return value;
}

module.exports = { compare };
