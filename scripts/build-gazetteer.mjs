#!/usr/bin/env node
// Builds data/gazetteer/{jp-prefectures,world-countries,world-cities}.json from the
// raw sources in scripts/sources/ (see scripts/sources/README.md for URLs).
// Run by hand: node scripts/build-gazetteer.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'scripts/sources');
const OUT = path.join(ROOT, 'data/gazetteer');
const { normalizeName } = require(path.join(ROOT, 'js/gazetteer.js'));

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readTsv = (file) => {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r\n|\r|\n/).filter(Boolean);
  const head = lines.shift().split('\t');
  return lines.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [head[i], v.trim()])));
};
const round = (v, d = 5) => Math.round(Number(v) * 10 ** d) / 10 ** d;
const uniq = (list, exclude = []) => {
  const seen = new Set(exclude.filter(Boolean).map(normalizeName));
  const out = [];
  list.filter(Boolean).forEach((v) => {
    const s = String(v).trim();
    const k = normalizeName(s);
    if (!s || seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
};
const today = new Date().toISOString().slice(0, 10);

// 地方公共団体コードの検査数字
function checkDigit(code5) {
  const d = String(code5).split('').map(Number);
  const sum = d[0] * 6 + d[1] * 5 + d[2] * 4 + d[3] * 3 + d[4] * 2;
  return String((11 - (sum % 11)) % 10);
}

function writeOut(kind, sources, entries) {
  const file = path.join(OUT, `${kind}.json`);
  const body = { version: 1, kind, generatedAt: today, sources, entries };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body)}\n`);
  console.log(`${kind}: ${entries.length} entries, ${fs.statSync(file).size} bytes`);
}

function reportCollisions(kind, entries) {
  const map = new Map();
  entries.forEach((e) => {
    [e.ja, e.en, ...(e.jaAlt || []), ...(e.enAlt || [])].filter(Boolean).forEach((name) => {
      const k = normalizeName(name);
      const set = map.get(k) || new Set();
      set.add(e.id);
      map.set(k, set);
    });
  });
  const dup = [...map].filter(([, ids]) => ids.size > 1);
  if (dup.length) console.log(`  ${kind}: ${dup.length} ambiguous keys, e.g.`, dup.slice(0, 12).map(([k, ids]) => `${k}=${[...ids].join('/')}`).join(', '));
}

// ---------- jp-prefectures ----------
const topo = readJson(path.join(ROOT, 'data/basemap/japan.topojson'));
const prefProps = new Map(topo.objects.japan.geometries.map((g) => [Number(g.properties.id), g.properties]));
const prefRows = readTsv(path.join(SRC, 'codefortokyo-pref-latlon.tsv'));
const PREF_EN_FIX = { 1: 'Hokkaido' };
const prefectures = prefRows.map((row) => {
  const code = Number(row.mcode.slice(0, 2));
  const props = prefProps.get(code);
  if (!props) throw new Error(`prefecture ${code} missing in japan.topojson`);
  if (props.nam_ja !== row.pref_ja) throw new Error(`name mismatch ${code}: ${props.nam_ja} vs ${row.pref_ja}`);
  const nam = props.nam; // e.g. "Tokyo To", "Hokkai Do"
  const base = PREF_EN_FIX[code] || nam.replace(/\s+(Ken|Fu|To|Do)$/, '');
  const suffix = (nam.match(/\s+(Ken|Fu|To|Do)$/) || [])[1];
  const two = String(code).padStart(2, '0');
  const code5 = `${two}000`;
  return {
    id: String(code),
    ja: row.pref_ja,
    jaAlt: [],
    en: base,
    enAlt: uniq([nam, suffix ? `${base}-${suffix.toLowerCase()}` : null, `${base} Prefecture`, code === 1 ? 'Hokkai Do' : null], [base]),
    codes: uniq([String(code), two, code5, code5 + checkDigit(code5), `JP-${two}`]),
    lat: round(row.lat),
    lon: round(row.lon),
    point: 'prefectural-office',
  };
}).sort((a, b) => Number(a.id) - Number(b.id));
if (prefectures.length !== 47) throw new Error(`expected 47 prefectures, got ${prefectures.length}`);
writeOut('jp-prefectures', [
  {
    name: '都道府県庁の緯度経度（Code for Tokyo ndl-dataset-2016 基礎データ／元データ：地方公共団体情報システム機構）',
    url: 'https://github.com/codefortokyo/ndl-dataset-2016/tree/master/%E5%9F%BA%E7%A4%8E%E3%83%87%E3%83%BC%E3%82%BF',
    license: '出典を明記して利用',
  },
  { name: 'Prefecture names and JIS codes from data/basemap/japan.topojson', url: '', license: 'see README' },
], prefectures);
reportCollisions('jp-prefectures', prefectures);

// ---------- world-countries ----------
const ne0 = readJson(path.join(SRC, 'ne_50m_admin_0_countries.geojson'));
const atlas = readJson(path.join(ROOT, 'data/basemap/countries-110m.json'));
const atlasIds = new Set(atlas.objects.countries.geometries.map((g) => g.id).filter(Boolean));
const aliases = readJson(path.join(ROOT, 'scripts/aliases/countries.json'));
const valid = (v) => v && v !== '-99' && v !== -99;
// Display names that differ from Natural Earth NAME_JA (the NE name stays as an alias).
const COUNTRY_JA = { TW: '台湾' };
const COUNTRY_EN = { CN: 'China' };
const countries = ne0.features.map((f) => {
  const p = f.properties;
  // Territories can share the parent's ISO codes (e.g. Australian Indian Ocean
  // Territories carry AU); only the unit whose ADM0_A3 equals ISO_A3_EH owns them.
  const home = !valid(p.ISO_A3_EH) || p.ADM0_A3 === p.ISO_A3_EH;
  const iso2 = home && valid(p.ISO_A2_EH) ? p.ISO_A2_EH : null;
  const iso3 = home && valid(p.ISO_A3_EH) ? p.ISO_A3_EH : null;
  const isoNum = home && valid(p.ISO_N3_EH) ? String(p.ISO_N3_EH).padStart(3, '0') : null;
  const id = iso2 || p.ADM0_A3;
  const extra = (iso2 && aliases[iso2]) || { ja: [], en: [] };
  const en = (iso2 && COUNTRY_EN[iso2]) || p.NAME_EN || p.NAME;
  const ja = (iso2 && COUNTRY_JA[iso2]) || p.NAME_JA || en;
  return {
    id,
    ja,
    jaAlt: uniq([p.NAME_JA, ...(extra.ja || [])], [ja]),
    en,
    enAlt: uniq([p.NAME_EN, p.ADMIN, p.NAME, p.NAME_LONG, p.FORMAL_EN, p.NAME_SORT, p.NAME_ALT, p.BRK_NAME, p.NAME_CIAWF, p.GEOUNIT, ...(extra.en || [])], [en]),
    codes: uniq([iso2, iso3, isoNum]),
    iso2,
    iso3,
    isoNum,
    atlasId: isoNum && atlasIds.has(isoNum) ? isoNum : null,
    continent: p.CONTINENT,
    lat: round(p.LABEL_Y, 4),
    lon: round(p.LABEL_X, 4),
    point: 'label',
  };
}).sort((a, b) => a.id.localeCompare(b.id));
const countryIds = new Set();
countries.forEach((c) => {
  if (countryIds.has(c.id)) throw new Error(`duplicate country id ${c.id}`);
  countryIds.add(c.id);
});
const countryByA3 = new Map(ne0.features.map((f) => [f.properties.ADM0_A3, f.properties]));
writeOut('world-countries', [
  { name: 'Natural Earth 1:50m Admin 0 – Countries (v5.1)', url: 'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/', license: 'public domain' },
  { name: 'Hand-reviewed aliases (scripts/aliases/countries.json)', url: '', license: '' },
], countries);
reportCollisions('world-countries', countries);

// ---------- world-cities ----------
const ne = readJson(path.join(SRC, 'ne_10m_populated_places.geojson'));
const shortCity = (ja) => {
  const m = String(ja || '').match(/^(.{2,})[市都]$/);
  return m ? [m[1]] : [];
};
const worldCities = ne.features
  .map((f) => f.properties)
  .filter((p) => p.ISO_A2 !== 'JP' || p.ADM0CAP === 1)
  .filter((p) => p.ADM0CAP === 1 || /Admin-0 capital/.test(p.FEATURECLA) || p.POP_MAX >= 2000000)
  .map((p) => {
    let iso2 = valid(p.ISO_A2) ? p.ISO_A2 : null;
    if (!iso2) iso2 = valid(countryByA3.get(p.ADM0_A3)?.ISO_A2_EH) ? countryByA3.get(p.ADM0_A3).ISO_A2_EH : null;
    const en = p.NAME_EN || p.NAME;
    // Natural Earth names Tokyo the city 東京都; keep that as an alias.
    const ja = p.ISO_A2 === 'JP' && p.ADM0CAP === 1 ? '東京' : (p.NAME_JA || en);
    return {
      id: `ne${p.NE_ID}`,
      ja,
      jaAlt: uniq([...shortCity(p.NAME_JA), p.NAME_JA], [ja]),
      en,
      enAlt: uniq([p.NAME, p.NAMEASCII, p.NAMEPAR, ...(p.NAMEALT ? String(p.NAMEALT).split('|') : [])], [en]),
      codes: [],
      country: iso2,
      pop: p.POP_MAX,
      capital: p.ADM0CAP === 1,
      lat: round(p.LATITUDE, 4),
      lon: round(p.LONGITUDE, 4),
      point: 'city',
    };
  });

// Japanese cities: every 市 and Tokyo's 23 special wards, at the municipal office.
const neJp = ne.features.map((f) => f.properties).filter((p) => p.ISO_A2 === 'JP' && p.NAME_JA);
const cityRows = readTsv(path.join(SRC, 'codefortokyo-city-latlon.tsv'));
const jpCities = cityRows
  .filter((row) => /^\d{5}$/.test(row.mcode))
  .filter((row) => /市$/.test(row.city_ja) || /^131(0[1-9]|1\d|2[0-3])$/.test(row.mcode))
  .map((row) => {
    const ne1 = neJp.find((p) => p.NAME_JA === row.city_ja);
    return {
      id: `jp${row.mcode}`,
      ja: row.city_ja,
      jaAlt: uniq([...shortCity(row.city_ja), row.city_ja_kana], [row.city_ja]),
      en: ne1 ? (ne1.NAME_EN || ne1.NAME) : null,
      enAlt: ne1 ? uniq([ne1.NAME, ne1.NAMEASCII], [ne1.NAME_EN]) : [],
      codes: uniq([row.mcode, row.mcode + checkDigit(row.mcode)]),
      country: 'JP',
      pop: ne1 ? ne1.POP_MAX : null,
      capital: false,
      lat: round(row.lat),
      lon: round(row.lon),
      point: 'municipal-office',
    };
  });
const cities = [...worldCities, ...jpCities].sort((a, b) => (b.pop || 0) - (a.pop || 0));
writeOut('world-cities', [
  { name: 'Natural Earth 1:10m Populated Places (v5.1): national capitals and places with POP_MAX >= 2,000,000 outside Japan, plus Tokyo', url: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/', license: 'public domain' },
  { name: '市区町村役場の緯度経度（Code for Tokyo ndl-dataset-2016 基礎データ／元データ：地方公共団体情報システム機構）: 全国の市と東京23区', url: 'https://github.com/codefortokyo/ndl-dataset-2016/tree/master/%E5%9F%BA%E7%A4%8E%E3%83%87%E3%83%BC%E3%82%BF', license: '出典を明記して利用' },
], cities);
reportCollisions('world-cities', cities);
