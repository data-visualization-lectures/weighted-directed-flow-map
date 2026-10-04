#!/usr/bin/env node
// Builds data/basemap/japan.topojson (47 prefectures) from 国土数値情報 行政区域データ (N03).
// Input: municipality GeoJSON produced by _app_data/prefectures-data-parser
//        (outputs_simplified/_rev02/*.geojson, N03-2025, already simplified at 50 m).
// Run by hand: node scripts/build-basemap-japan.mjs [path/to/outputs_simplified/_rev02]
// Needs network access for `npx mapshaper` on the first run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, '../../_app_data/prefectures-data-parser/outputs_simplified/_rev02'));
const OUT = path.join(ROOT, 'data/basemap/japan.topojson');
const names = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/aliases/prefectures-en.json'), 'utf8'));
const tmp = path.join(os.tmpdir(), `wdfm-japan-${process.pid}.json`);

const inputs = fs.readdirSync(SRC).filter((f) => f.endsWith('.geojson')).map((f) => path.join(SRC, f));
if (inputs.length < 47) throw new Error(`expected the N03 municipality files in ${SRC}`);

execFileSync('npx', [
  '-y', 'mapshaper@0.6',
  '-i', ...inputs, 'combine-files', 'snap',
  '-merge-layers', 'force',
  '-each', 'pref=Number(String(N03_007).slice(0,2))',
  '-dissolve2', 'pref', 'copy-fields=N03_001',
  '-simplify', '0.6%', 'weighted', 'keep-shapes',
  '-filter-islands', 'min-area=4km2',
  '-filter-slivers',
  '-clean',
  '-rename-layers', 'japan',
  '-o', tmp, 'format=topojson', 'quantization=100000',
], { stdio: 'inherit' });

const topo = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);
const geoms = topo.objects.japan.geometries;
if (geoms.length !== 47) throw new Error(`expected 47 prefectures, got ${geoms.length}`);
geoms.forEach((g) => {
  const id = Number(g.properties.pref);
  const entry = names[String(id)];
  if (!entry || entry.ja !== g.properties.N03_001) throw new Error(`prefecture ${id} name mismatch`);
  g.properties = { nam: entry.en, nam_ja: entry.ja, id };
});
geoms.sort((a, b) => a.properties.id - b.properties.id);
topo.metadata = {
  source: '国土数値情報（行政区域データ N03, 2025年）国土交通省 — 都道府県単位に結合・簡略化',
  sourceUrl: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html',
  generatedBy: 'scripts/build-basemap-japan.mjs',
};
fs.writeFileSync(OUT, `${JSON.stringify(topo)}\n`);
console.log(`data/basemap/japan.topojson: ${geoms.length} prefectures, ${fs.statSync(OUT).size} bytes`);
