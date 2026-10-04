// Minimal .xlsx reader for the sample build scripts (no dependencies; needs `unzip`).
// Returns a sheet as a 2D array of strings: rows[r][c].
import { execFileSync } from 'node:child_process';

function unzipEntry(file, entry) {
  return execFileSync('unzip', ['-p', file, entry], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

function decode(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function sheetNames(file) {
  const wb = unzipEntry(file, 'xl/workbook.xml');
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decode(m[1]));
}

export function readSheet(file, sheetIndex = 1) {
  let shared = [];
  try {
    const ss = unzipEntry(file, 'xl/sharedStrings.xml');
    shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  } catch (_) { /* no shared strings */ }
  const xml = unzipEntry(file, `xl/worksheets/sheet${sheetIndex}.xml`);
  const rows = [];
  for (const row of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = Number(row[1]) - 1;
    const out = [];
    for (const cell of row[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      if (!ref) continue;
      const type = (attrs.match(/t="([^"]+)"/) || [])[1];
      const body = cell[2] || '';
      let value = '';
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (type === 's' && v != null) value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (v != null) value = decode(v);
      out[colIndex(ref)] = value;
    }
    rows[r] = Array.from(out, (x) => (x == null ? '' : x));
  }
  return Array.from(rows, (x) => x || []);
}
