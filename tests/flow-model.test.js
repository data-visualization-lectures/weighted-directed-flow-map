'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../js/flow-model.js');
const Z = require('../js/gazetteer.js');
const S = require('../js/settings-spec.js');
const { parseCsv } = require('./helpers/csv.js');

const ROOT = path.join(__dirname, '..');
const indexes = {};
Z.KINDS.forEach((kind) => {
  indexes[kind] = Z.createIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/gazetteer', `${kind}.json`), 'utf8')));
});
const geoRate = (labels) => Z.geoRate(labels, indexes);

function rowsOf(text) {
  return parseCsv(text);
}

function graphOf(rows, overrides = {}, mode = 'auto') {
  const det = M.detectFormat(rows, rows.columns, { geoRate });
  const settings = { ...S.defaultSettings(), ...M.inferMapping(rows, rows.columns, det), detectedFormat: det.format, ...overrides };
  return M.buildGraph(rows, settings, (labels, coordsByLabel) => Z.createResolver({ mode, indexes, labels, coordsByLabel }));
}

test('parseNumber handles commas, full-width digits and statistics markers', () => {
  assert.equal(M.parseNumber('1,234'), 1234);
  assert.equal(M.parseNumber('１２３'), 123);
  assert.equal(M.parseNumber(' 5.5 '), 5.5);
  assert.equal(M.parseNumber('-'), 0);
  assert.equal(M.parseNumber('…'), null);
  assert.equal(M.parseNumber('x'), null);
  assert.equal(M.parseNumber(''), null);
  assert.ok(Number.isNaN(M.parseNumber('1,234人')));
});

test('edge lists are detected from English and Japanese aliases', () => {
  const en = rowsOf('from,to,value\nTokyo,Osaka,10\nOsaka,Tokyo,4\n');
  assert.equal(M.detectFormat(en, en.columns, { geoRate }).format, 'edge-list');
  const ja = rowsOf('出発地,到着地,金額（千円）\n東京,大阪,10\n大阪,東京,4\n');
  const det = M.detectFormat(ja, ja.columns, { geoRate });
  assert.equal(det.format, 'edge-list');
  const mapping = M.inferMapping(ja, ja.columns, det);
  assert.equal(mapping.fromColumn, '出発地');
  assert.equal(mapping.toColumn, '到着地');
  assert.equal(mapping.valueColumn, '金額（千円）');
});

test('square and rectangular OD matrices are detected; wide time series is not', () => {
  const square = rowsOf(',東京都,大阪府,愛知県\n東京都,-,5,3\n大阪府,6,-,2\n愛知県,4,1,-\n');
  assert.equal(M.detectFormat(square, square.columns, { geoRate }).format, 'od-matrix');
  const rect = rowsOf('pref,China,United States,Korea\nTokyo,5,3,1\nOsaka,2,1,1\n');
  assert.equal(M.detectFormat(rect, rect.columns, { geoRate }).format, 'od-matrix');
  const wide = rowsOf('pref,2019,2020,2021\nfoo,1,2,3\nbar,4,5,6\n');
  assert.equal(M.detectFormat(wide, wide.columns, { geoRate }).format, 'unknown');
});

test('coordinate and group columns are found automatically', () => {
  assert.deepEqual(M.coordinateRole('from_lat'), { role: 'from', axis: 'lat' });
  assert.deepEqual(M.coordinateRole('出発地緯度'), { role: 'from', axis: 'lat' });
  assert.deepEqual(M.coordinateRole('dest_lng'), { role: 'to', axis: 'lon' });
  assert.equal(M.coordinateRole('lat'), null);
  const rows = rowsOf('year,origin,destination,trips,origin_lat,origin_lon,destination_lat,destination_lon\n2024,A,B,5,35,139,34,135\n2025,A,B,7,35,139,34,135\n');
  const mapping = M.inferMapping(rows, rows.columns, M.detectFormat(rows, rows.columns, { geoRate }));
  assert.equal(mapping.groupColumn, 'year');
  assert.equal(mapping.valueColumn, 'trips');
  assert.equal(mapping.fromLatColumn, 'origin_lat');
  assert.equal(mapping.toLonColumn, 'destination_lon');
});

test('totals, aggregates, self loops and negative values are excluded and counted', () => {
  const rows = rowsOf('from,to,value\n東京,大阪,10\n東京都,大阪府,5\n東京,東京都,3\n世界,日本,9\n合計,大阪,99\n大阪,東京,-2\n大阪,東京,x\n');
  const g = graphOf(rows, {}, 'jp-prefectures');
  const flow = g.flows.find((f) => f.from === 'jp:13' && f.to === 'jp:27');
  assert.equal(flow.value, 15, '東京 and 東京都 merge');
  assert.equal(g.report.selfLoops, 1);
  assert.equal(g.issues.negativeValues, 1);
  assert.equal(g.issues.totalsExcluded, 1);
  assert.equal(g.issues.missingValues, 1, 'x is a suppression marker');
  assert.ok(g.report.aggregates.has('世界'));
});

test('net mode keeps one flow per pair in the larger direction', () => {
  const rows = rowsOf('from,to,value\n東京,大阪,10\n大阪,東京,4\n東京,愛知,3\n愛知,東京,3\n');
  const g = graphOf(rows);
  const gross = M.view(g, { flowMode: 'gross', topN: 100 });
  assert.equal(gross.flows.length, 4);
  assert.ok(gross.flows.every((f) => f.partnerDrawn));
  const net = M.view(g, { flowMode: 'net', topN: 100 });
  assert.equal(net.flows.length, 1, 'equal pairs vanish in net mode');
  assert.equal(net.flows[0].value, 6);
  assert.equal(net.flows[0].reverseValue, 4);
});

test('focus, minValue and topN with keepPairs', () => {
  const rows = rowsOf('from,to,value\n東京,大阪,10\n大阪,東京,1\n東京,愛知,8\n愛知,大阪,7\n大阪,愛知,6\n');
  const g = graphOf(rows);
  const out = M.view(g, { focusNode: 'jp:13', focusDirection: 'out', topN: 100 });
  assert.deepEqual(out.flows.map((f) => f.to).sort(), ['jp:23', 'jp:27']);
  const inn = M.view(g, { focusNode: 'jp:13', focusDirection: 'in', topN: 100 });
  assert.deepEqual(inn.flows.map((f) => f.from), ['jp:27']);
  assert.equal(M.view(g, { minValue: 7, topN: 100 }).flows.length, 3);
  const paired = M.view(g, { topN: 1, keepPairs: true });
  assert.equal(paired.flows.length, 2, 'both directions of the top pair are kept');
  assert.equal(M.view(g, { topN: 1, keepPairs: false }).flows.length, 1);
});

test('groups: latest period by default, __all__ sums, width domain shared', () => {
  const rows = rowsOf('年,出発地,到着地,値\n2024,東京,大阪,10\n2025,東京,大阪,4\n2025,大阪,東京,2\n');
  const g = graphOf(rows);
  assert.deepEqual(g.groups, ['2024', '2025']);
  const v = M.view(g, { topN: 100 });
  assert.equal(v.group, '2025');
  assert.equal(v.vmax, 10, 'domain spans all groups');
  const all = M.view(g, { groupValue: '__all__', topN: 100 });
  assert.equal(all.flows.find((f) => f.from === 'jp:13').value, 14);
});

test('node stats: in, out, net = in - out', () => {
  const rows = rowsOf('from,to,value\n東京,大阪,10\n大阪,東京,4\n');
  const v = M.view(graphOf(rows), { topN: 100 });
  const tokyo = v.nodes.find((n) => n.id === 'jp:13');
  assert.equal(tokyo.out, 10);
  assert.equal(tokyo.in, 4);
  assert.equal(tokyo.net, -6);
  assert.equal(tokyo.total, 14);
});

test('coordinate columns place nodes that no gazetteer knows', () => {
  const rows = rowsOf('from,to,value,from_lat,from_lon,to_lat,to_lon\nAlpha,Beta,5,10,20,11,21\nBeta,Alpha,3,11,21,10,20\n');
  const g = graphOf(rows);
  assert.equal(g.nodes.size, 2);
  const alpha = [...g.nodes.values()].find((n) => n.label === 'Alpha');
  assert.equal(alpha.lat, 10);
  assert.equal(alpha.lon, 20);
  assert.ok(alpha.id.startsWith('pt:'));
});

test('bundled samples: detection, full resolution and published totals', () => {
  const mig = parseCsv(fs.readFileSync(path.join(ROOT, 'samples/jp-prefecture-migration-2025.csv'), 'utf8'));
  const g = graphOf(mig);
  assert.equal(g.format, 'od-matrix');
  assert.equal(g.nodes.size, 47);
  assert.equal(g.report.unresolved.size, 0);
  const total = g.flows.reduce((acc, f) => acc + f.value, 0);
  assert.equal(total, 2515731, '住民基本台帳人口移動報告 2025 都道府県間移動者数');

  const migEn = parseCsv(fs.readFileSync(path.join(ROOT, 'samples/jp-prefecture-migration-2025.en.csv'), 'utf8'));
  assert.equal(graphOf(migEn).nodes.size, 47);

  for (const file of ['jp-trade-by-country-2021-2025.csv', 'jp-trade-by-country-2021-2025.en.csv']) {
    const trade = parseCsv(fs.readFileSync(path.join(ROOT, 'samples', file), 'utf8'));
    const tg = graphOf(trade);
    assert.equal(tg.format, 'edge-list', file);
    assert.equal(tg.report.unresolved.size, 0, file);
    assert.equal(tg.nodes.size, 31, file);
    assert.deepEqual(tg.groups, ['2021', '2022', '2023', '2024', '2025']);
  }
});

test('CSV export rows carry reverse value and net', () => {
  const rows = rowsOf('from,to,value\n東京,大阪,10\n大阪,東京,4\n');
  const g = graphOf(rows);
  const csv = M.toCsvRows(M.view(g, { topN: 100 }), g);
  const r = csv.find((x) => x.from === 'jp:13');
  assert.equal(r.reverse_value, 4);
  assert.equal(r.net, 6);
  assert.equal(r.from_label, '東京都');
});
