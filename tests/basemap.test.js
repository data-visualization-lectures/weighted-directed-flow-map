'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const topojson = require('../vendor/topojson-client.min.js');
const B = require('../js/basemap.js');

const topo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/basemap/japan.topojson'), 'utf8'));
const features = topojson.feature(topo, topo.objects.japan).features;
const split = B.splitJapan(features);
const ids = (list) => new Set(list.map((f) => Number(f.properties.id)));
const latRange = (f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const lats = polys.flatMap((p) => p[0].map((c) => c[1]));
  return [Math.min(...lats), Math.max(...lats)];
};

test('islands south of Kyushu go to the inset; Yakushima stays', () => {
  assert.ok(B.isSouthWestPoint(127.68, 26.21), 'Naha');
  assert.ok(B.isSouthWestPoint(129.49, 28.38), 'Amami');
  assert.ok(!B.isSouthWestPoint(130.55, 30.35), 'Yakushima');
  assert.ok(!B.isSouthWestPoint(130.56, 31.56), 'Kagoshima city');
  assert.deepEqual([...ids(split.inset)].sort((a, b) => a - b), [46, 47], 'Kagoshima (Amami/Tokara) and Okinawa');
  assert.ok(!ids(split.main).has(47), 'Okinawa leaves the main map entirely');
  const kagoshimaMain = split.main.find((f) => f.properties.id === 46);
  assert.ok(latRange(kagoshimaMain)[0] >= 30, 'only Kyushu, Osumi islands and Yakushima remain for Kagoshima');
  split.inset.forEach((f) => assert.ok(latRange(f)[1] < 30.2, `inset piece of ${f.properties.id} is south of 30N`));
});

test('remote islands do not drive the extent but are still drawn', () => {
  assert.ok(B.isRemotePoint(142.19, 27.09), 'Ogasawara');
  assert.ok(B.isRemotePoint(139.78, 33.11), 'Hachijojima');
  assert.ok(!B.isRemotePoint(139.36, 34.75), 'Izu Oshima stays');
  const tokyoFit = split.fit.find((f) => f.properties.id === 13);
  assert.ok(latRange(tokyoFit)[0] > 33.6, 'Tokyo fit ignores Hachijo and Ogasawara');
  const tokyoMain = split.main.find((f) => f.properties.id === 13);
  assert.ok(latRange(tokyoMain)[0] < 28, 'Ogasawara is still drawn');
  assert.equal(split.main.length, 46);
  assert.equal(split.fitWithInset.length, 47);
});
