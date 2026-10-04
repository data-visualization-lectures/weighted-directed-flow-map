'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Z = require('../js/gazetteer.js');

const ROOT = path.join(__dirname, '..');
const raw = {};
const idx = {};
Z.KINDS.forEach((kind) => {
  raw[kind] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/gazetteer', `${kind}.json`), 'utf8'));
  idx[kind] = Z.createIndex(raw[kind]);
});
const id = (kind, label, opts) => {
  const r = idx[kind].lookup(label, opts || {});
  return r.status === 'ok' ? r.entry.id : r.status;
};

test('normalizeName keeps Japanese voicing marks and strips Latin accents', () => {
  assert.equal(Z.normalizeName("Côte d'Ivoire"), 'cote d ivoire');
  assert.equal(Z.normalizeName('ガ'), 'ガ');
  assert.equal(Z.normalizeName(' 東京都 '), '東京都');
});

test('prefectures: names, short forms, English forms and JIS codes', () => {
  ['東京都', '東京', 'Tokyo', 'TOKYO-TO', 'Tokyo To', '13', '13000', '130001', 'JP-13'].forEach((label) => {
    assert.equal(id('jp-prefectures', label), '13', label);
  });
  assert.equal(id('jp-prefectures', '京都'), '26', '京都 never matches 東京');
  ['北海道', 'Hokkaido', 'Hokkai Do', '1', '01'].forEach((label) => assert.equal(id('jp-prefectures', label), '1', label));
  assert.equal(id('jp-prefectures', '北海'), 'none', '北海道 has no short form');
  assert.equal(id('jp-prefectures', 'Hyōgo Prefecture'), '28');
});

test('countries: ISO codes, Japanese trade names and aliases', () => {
  ['JP', 'JPN', '日本', 'Japan'].forEach((label) => assert.equal(id('world-countries', label), 'JP', label));
  ['大韓民国', '韓国', 'Republic of Korea', 'KOR'].forEach((label) => assert.equal(id('world-countries', label), 'KR', label));
  assert.equal(id('world-countries', '中華人民共和国'), 'CN');
  assert.equal(id('world-countries', '台湾'), 'TW');
  assert.equal(id('world-countries', '香港'), 'HK');
  assert.equal(id('world-countries', "Cote d'Ivoire"), 'CI');
  assert.equal(id('world-countries', 'Georgia'), 'GE');
  assert.equal(id('world-countries', 'Congo'), 'ambiguous');
  assert.equal(id('world-countries', '392'), 'none', 'numeric ISO only when asked');
  assert.equal(id('world-countries', '392', { numericCodes: true }), 'JP');
});

test('cities: Japanese short names, municipal codes and ambiguity', () => {
  assert.equal(raw['world-cities'].entries.find((e) => e.id === id('world-cities', '東京')).ja, '東京');
  assert.equal(id('world-cities', '名古屋'), 'jp23100');
  assert.equal(id('world-cities', '13101'), 'jp13101');
  assert.equal(id('world-cities', '府中市'), 'ambiguous');
});

test('auto mode picks the gazetteer that resolves the most labels', () => {
  assert.equal(Z.chooseAuto(['東京', '大阪', '名古屋', '福岡'], idx).kind, 'world-cities');
  const prefs = raw['jp-prefectures'].entries.map((e) => e.ja);
  assert.equal(Z.chooseAuto(prefs, idx).kind, 'jp-prefectures');
  assert.equal(Z.chooseAuto(['日本', '中華人民共和国', 'アメリカ合衆国'], idx).kind, 'world-countries');
});

test('resolver: overrides and coordinates beat the gazetteer', () => {
  const coords = new Map([['Somewhere', { lat: 1, lon: 2 }]]);
  const r = Z.createResolver({ mode: 'auto', indexes: idx, labels: ['Somewhere', 'Congo'], coordsByLabel: coords, overrides: { congo: 'cty:CD' } });
  assert.equal(r.resolve('Somewhere').node.id, 'pt:somewhere');
  assert.equal(r.resolve('Congo').node.id, 'cty:CD');
});

test('data integrity', () => {
  const prefs = raw['jp-prefectures'].entries;
  assert.equal(prefs.length, 47);
  const topo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/basemap/japan.topojson'), 'utf8'));
  const topoIds = new Set(topo.objects.japan.geometries.map((g) => String(g.properties.id)));
  prefs.forEach((p) => {
    assert.ok(topoIds.has(p.id), `prefecture ${p.id} in topojson`);
    assert.ok(p.lat > 24 && p.lat < 46 && p.lon > 122 && p.lon < 146, `prefecture ${p.id} inside Japan`);
  });
  const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/basemap/countries-110m.json'), 'utf8'));
  const atlasIds = new Set(atlas.objects.countries.geometries.map((g) => g.id));
  const seen = new Set();
  raw['world-countries'].entries.forEach((c) => {
    assert.ok(!seen.has(c.id), `unique id ${c.id}`);
    seen.add(c.id);
    if (c.atlasId) assert.ok(atlasIds.has(c.atlasId), `atlas id ${c.atlasId}`);
    assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180);
  });
  const cityIds = new Set();
  raw['world-cities'].entries.forEach((c) => {
    assert.ok(!cityIds.has(c.id), `unique city ${c.id}`);
    cityIds.add(c.id);
  });
});
