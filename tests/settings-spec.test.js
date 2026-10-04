'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/settings-spec.js');
const G = require('../js/flow-geometry.js');

const fields = S.SETTINGS_SPEC.fields;

test('identity and version', () => {
  assert.equal(S.SETTINGS_SPEC.version, 1);
  assert.equal(S.SETTINGS_SPEC.chartType, 'weighted-directed-flow-map');
  assert.deepEqual(S.SETTINGS_SPEC.migrations, []);
});

test('every field has a type and a valid default', () => {
  Object.entries(fields).forEach(([key, spec]) => {
    assert.ok(spec.type, key);
    assert.ok('default' in spec, key);
    if (spec.type === 'number') {
      assert.ok(Number.isFinite(spec.min) && Number.isFinite(spec.max), `${key} range`);
      assert.ok(spec.default >= spec.min && spec.default <= spec.max, `${key} default in range`);
    }
    if (spec.type === 'enum') assert.ok(spec.values.includes(spec.default), `${key} default in values`);
  });
});

test('defaults: arrow shape, empty annotations, gross flows', () => {
  const d = S.defaultSettings();
  assert.equal(d.flowShape, 'arrow');
  assert.equal(d.flowMode, 'gross');
  ['annotateTitle', 'annotateSource', 'annotateSourceUrl', 'valueUnit'].forEach((k) => assert.equal(d[k], ''));
  assert.deepEqual(Object.keys(d).sort(), Object.keys(fields).sort());
  assert.deepEqual([...S.FLOW_SHAPES].sort(), Object.keys(G.SHAPES).sort(), 'every shape has geometry params');
});

test('each field has exactly one owner', () => {
  const owners = Object.values(S.FIELD_OWNERS).flat();
  assert.equal(new Set(owners).size, owners.length, 'no field has two owners');
  assert.deepEqual([...owners].sort(), Object.keys(fields).sort(), 'owners cover every field');
  assert.deepEqual(S.CONTROL_KEYS, ['focusNode', 'focusDirection', 'flowMode', 'groupValue']);
});

test('sanitizeSettings fixes cross-field and type problems', () => {
  const s = S.sanitizeSettings({
    minWidth: 9, maxWidth: 4, flowColor: 'red', labelTopN: 50, topN: 20,
    curvature: 5, flowShape: 'zigzag', nodeOverrides: { a: 'jp:13', b: 3 }, fromColumn: 'gone',
  }, ['from', 'to']);
  assert.equal(s.minWidth, 4);
  assert.equal(s.flowColor, '#2563eb');
  assert.equal(s.labelTopN, 20);
  assert.equal(s.curvature, 0.6);
  assert.equal(s.flowShape, 'arrow');
  assert.deepEqual(s.nodeOverrides, { a: 'jp:13' });
  assert.equal(s.fromColumn, null);
});

test('pair layout defaults to two lanes', () => {
  assert.equal(S.defaultSettings().pairLayout, 'lanes');
  assert.deepEqual(S.SETTINGS_SPEC.fields.pairLayout.values, ['lanes', 'single']);
});
