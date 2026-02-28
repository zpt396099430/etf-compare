const { FIELD_LABELS, SECURITY_DISPLAY_FIELDS } = require('./labels');

function normalizeVal(v) {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v).trim();
  if (s.endsWith('%')) {
    const n = parseFloat(s);
    if (!isNaN(n)) return String(n / 100);
  }
  const n = parseFloat(s);
  if (!isNaN(n)) return String(n);
  return s.toLowerCase();
}

/**
 * Compare two normalized data objects.
 * mappings: { fieldName: { '1': '允许', ... } } — applied to source A values before comparison
 * Returns { headerRows, securityRows, stats }
 */
function compare(dataA, dataB, mappings = {}) {
  function applyMapping(field, value) {
    if (value === null || value === undefined) return value;
    const m = mappings[field];
    if (m) return m[String(value)] ?? value;
    return value;
  }

  // ── Header rows ────────────────────────────────────────────────────────────
  const allHeaderKeys = new Set([...Object.keys(dataA.headers), ...Object.keys(dataB.headers)]);
  const headerRows = [];
  for (const field of allHeaderKeys) {
    const rawA = dataA.headers[field] ?? null;
    const rawB = dataB.headers[field] ?? null;
    const mappedA = applyMapping(field, rawA);
    const diff = normalizeVal(mappedA) !== normalizeVal(rawB);
    headerRows.push({ field, labelCN: FIELD_LABELS[field] || field, valueA: rawA, valueB: rawB, diff });
  }

  // ── Security rows ──────────────────────────────────────────────────────────
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

  // Sort: only-in first, then diffs, then same
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
