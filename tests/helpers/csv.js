'use strict';

// Minimal RFC 4180 CSV parser for tests (same row shape as d3.csvParse, incl. rows.columns).
function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      records.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const columns = records.shift() || [];
  const rows = records.filter((r) => r.length > 1 || r[0] !== '').map((r) => {
    const obj = {};
    columns.forEach((c, i) => { obj[c] = r[i] == null ? '' : r[i]; });
    return obj;
  });
  rows.columns = columns;
  return rows;
}

module.exports = { parseCsv };
