/**
 * Compare two normalized data objects (from parseXML / parseAPIData)
 * Returns { headerDiffs, securityDiffs, onlyInA, onlyInB }
 */
function compare(dataA, dataB) {
  const headerDiffs = [];
  const securityDiffs = [];
  const onlyInA = [];
  const onlyInB = [];

  // --- Header comparison ---
  const allHeaderKeys = new Set([
    ...Object.keys(dataA.headers),
    ...Object.keys(dataB.headers)
  ]);

  for (const key of allHeaderKeys) {
    const valA = dataA.headers[key];
    const valB = dataB.headers[key];
    if (normalizeVal(valA) !== normalizeVal(valB)) {
      headerDiffs.push({ field: key, valueA: valA ?? null, valueB: valB ?? null });
    }
  }

  // --- Securities comparison ---
  const allIds = new Set([
    ...Object.keys(dataA.securities),
    ...Object.keys(dataB.securities)
  ]);

  for (const id of allIds) {
    const secA = dataA.securities[id];
    const secB = dataB.securities[id];

    if (!secA) { onlyInB.push({ id, data: secB }); continue; }
    if (!secB) { onlyInA.push({ id, data: secA }); continue; }

    const allFields = new Set([...Object.keys(secA), ...Object.keys(secB)]);
    const diffs = [];
    for (const f of allFields) {
      if (normalizeVal(secA[f]) !== normalizeVal(secB[f])) {
        diffs.push({ field: f, valueA: secA[f] ?? null, valueB: secB[f] ?? null });
      }
    }
    if (diffs.length > 0) {
      securityDiffs.push({ id, name: secA.InstrumentName || secB.InstrumentName, diffs });
    }
  }

  return { headerDiffs, securityDiffs, onlyInA, onlyInB };
}

function normalizeVal(v) {
  if (v === undefined || v === null || v === '') return '';
  // normalize numbers: "0.10" == "0.1", "10.000%" == "0.1"
  const s = String(v).trim();
  // strip trailing % and convert to decimal
  if (s.endsWith('%')) {
    const n = parseFloat(s);
    if (!isNaN(n)) return String(n / 100);
  }
  const n = parseFloat(s);
  if (!isNaN(n) && String(n) !== 'NaN') return String(n);
  return s.toLowerCase();
}

module.exports = { compare };
