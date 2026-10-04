#!/usr/bin/env node
// Builds the bundled sample CSVs from official files in scripts/sources/.
// Run by hand: node scripts/build-samples.mjs
// Values are copied exactly as published; only the layout is changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheet } from './lib/read-xlsx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'scripts/sources');
const OUT = path.join(ROOT, 'samples');
const prefGaz = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/gazetteer/jp-prefectures.json'), 'utf8'));
const prefById = new Map(prefGaz.entries.map((e) => [Number(e.id), e]));

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(name, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), `${text}\n`);
  console.log(`samples/${name}: ${rows.length} rows x ${header.length} columns`);
}

function cleanNumber(value) {
  const s = String(value ?? '').trim();
  if (s === '' || s === '-' || s === '－') return 0;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`not a number: ${value}`);
  return n;
}

// ---------- 住民基本台帳人口移動報告 2025年 第2表（移動者） ----------
function buildMigration() {
  const file = path.join(SRC, 'estat-a002.xlsx');
  const rows = readSheet(file, 1); // sheet "移動者"
  const blockStarts = [];
  rows.forEach((r, i) => { if (String(r[8] || '').trim().startsWith('総')) blockStarts.push(i); });
  const matrix = new Map(); // origin code -> Map(dest code -> value)
  const publishedTotal = new Map(); // origin code -> 都道府県間移動者数 (総数)
  blockStarts.forEach((start, bi) => {
    const end = bi + 1 < blockStarts.length ? blockStarts[bi + 1] : rows.length;
    const names = rows[start - 5] || [];
    const sexRow = rows[start - 3] || [];
    for (let c = 12; c < names.length; c += 3) {
      if (!String(sexRow[c] || '').startsWith('総')) continue;
      const label = String(names[c] || '').replace(/\s|　/g, '');
      const isTotal = label.startsWith('都道府県間移動者数');
      const m = label.match(/^(\d{2})(.+)$/);
      if (!isTotal && !m) continue;
      const destCode = m ? Number(m[1]) : null;
      if (destCode && (destCode < 1 || destCode > 47)) continue;
      // Skip area columns such as 21大都市計 that also start with two digits.
      if (destCode && prefById.get(destCode).ja !== m[2]) continue;
      for (let r = start + 1; r < end; r += 1) {
        const row = rows[r] || [];
        const code = String(row[8] || '').trim();
        // Prefecture rows have an empty city code; city rows (札幌市 etc.) do not.
        if (!/^\d{2}$/.test(code) || String(row[9] || '').trim()) continue;
        const originCode = Number(code);
        if (originCode < 1 || originCode > 47) continue;
        if (String(row[10] || '').trim() !== prefById.get(originCode).ja) throw new Error(`origin name mismatch row ${r}`);
        const value = cleanNumber(row[c]);
        if (isTotal) { publishedTotal.set(originCode, value); continue; }
        if (!matrix.has(originCode)) matrix.set(originCode, new Map());
        matrix.get(originCode).set(destCode, value);
      }
    }
  });
  const codes = [...prefById.keys()].sort((a, b) => a - b);
  if (matrix.size !== 47) throw new Error(`expected 47 origins, got ${matrix.size}`);
  codes.forEach((o) => {
    const dests = matrix.get(o);
    if (dests.size !== 47) throw new Error(`origin ${o}: ${dests.size} destinations`);
    const sum = [...dests.entries()].filter(([d]) => d !== o).reduce((acc, [, v]) => acc + v, 0);
    if (sum !== publishedTotal.get(o)) throw new Error(`origin ${o}: sum ${sum} != published ${publishedTotal.get(o)}`);
    if (dests.get(o) !== 0) throw new Error(`origin ${o}: diagonal is not empty`);
  });
  const grand = [...publishedTotal.values()].reduce((a, b) => a + b, 0);
  console.log(`migration: row sums match the published totals (grand total ${grand})`);
  const cell = (o, d) => (o === d ? '-' : matrix.get(o).get(d));
  writeCsv(
    'jp-prefecture-migration-2025.csv',
    ['移動前の住所地', ...codes.map((c) => prefById.get(c).ja)],
    codes.map((o) => [prefById.get(o).ja, ...codes.map((d) => cell(o, d))]),
  );
  writeCsv(
    'jp-prefecture-migration-2025.en.csv',
    ['Origin', ...codes.map((c) => prefById.get(c).en)],
    codes.map((o) => [prefById.get(o).en, ...codes.map((d) => cell(o, d))]),
  );
  return grand;
}

buildMigration();

// ---------- 財務省貿易統計 国別輸出入（年別、千円） ----------
const { normalizeName, createIndex, createResolver } = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'js/gazetteer.js'));

function readSjisCsv(file) {
  const text = new TextDecoder('shift_jis').decode(fs.readFileSync(file));
  return text.split(/\r\n|\r|\n/).map((line) => line.split(',').map((v) => v.trim()));
}

function customsCountryNames() {
  const html = new TextDecoder('shift_jis').decode(fs.readFileSync(path.join(SRC, 'customs/a1.htm')));
  const cells = html.replace(/<[^>]*>/g, '|').replace(/&nbsp;/g, ' ').split('|').map((s) => s.trim()).filter(Boolean);
  const names = new Map();
  for (let i = 0; i < cells.length - 1; i += 1) {
    if (/^\d{3}$/.test(cells[i]) && !/^\d{3}$/.test(cells[i + 1]) && !names.has(cells[i])) names.set(cells[i], cells[i + 1]);
  }
  return names;
}

function buildTrade() {
  const YEARS = ['2021', '2022', '2023', '2024', '2025'];
  const TOP = 30;
  const names = customsCountryNames();
  const files = fs.readdirSync(path.join(SRC, 'customs')).filter((f) => /^d42ca\d+\.csv$/.test(f));
  const values = new Map(); // code -> {year -> {exp, imp}}
  files.forEach((f) => {
    const rows = readSjisCsv(path.join(SRC, 'customs', f));
    const header = rows.find((r) => r[0] === 'Years');
    if (!header) throw new Error(`no header in ${f}`);
    rows.filter((r) => YEARS.includes(r[0])).forEach((r) => {
      header.forEach((h, i) => {
        const m = h.match(/^(Exp|Imp)-(\d{3})$/);
        if (!m) return;
        const code = m[2];
        if (!values.has(code)) values.set(code, {});
        const byYear = values.get(code);
        byYear[r[0]] = byYear[r[0]] || {};
        byYear[r[0]][m[1] === 'Exp' ? 'exp' : 'imp'] = cleanNumber(r[i]);
      });
    });
  });
  const ranked = [...values.entries()]
    .map(([code, byYear]) => ({ code, total: (byYear['2025']?.exp || 0) + (byYear['2025']?.imp || 0), byYear }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP);

  const countries = createIndex({ kind: 'world-countries', ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data/gazetteer/world-countries.json'), 'utf8')) });
  const resolver = createResolver({ mode: 'world-countries', indexes: { 'world-countries': countries }, lang: 'en' });
  const enName = (ja) => {
    const res = resolver.resolve(ja);
    if (res.status !== 'ok') throw new Error(`trade partner not in gazetteer: ${ja}`);
    return res.node.labelEn;
  };
  const rowsJa = [];
  const rowsEn = [];
  YEARS.forEach((year) => {
    ranked.forEach(({ code, byYear }) => {
      const ja = names.get(code);
      if (!ja) throw new Error(`no country name for ${code}`);
      const en = enName(ja);
      const v = byYear[year] || {};
      rowsJa.push([year, '日本', ja, v.exp], [year, ja, '日本', v.imp]);
      rowsEn.push([year, 'Japan', en, v.exp], [year, en, 'Japan', v.imp]);
    });
  });
  writeCsv('jp-trade-by-country-2021-2025.csv', ['年', '出発地', '到着地', '金額（千円）'], rowsJa);
  writeCsv('jp-trade-by-country-2021-2025.en.csv', ['Year', 'From', 'To', 'Value (thousand yen)'], rowsEn);
  console.log('trade partners:', ranked.map((r) => names.get(r.code)).join(', '));
}

buildTrade();
