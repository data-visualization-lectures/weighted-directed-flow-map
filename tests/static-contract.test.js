'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const index = read('index.html');
const share = read('share.html');
const css = read('css/style.css') + read('css/dvz-common.css');
const allJs = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true })
  .filter((f) => f.endsWith('.js'))
  .map((f) => read(path.join('js', f)))
  .join('\n');

test('both pages have #dvz-controls and no catalog switcher', () => {
  [index, share].forEach((html) => {
    assert.match(html, /id="dvz-controls"/);
    assert.doesNotMatch(html, /chart-selector|chart-switcher|chart-back-btn/);
  });
});

test('editor has the five standard tabs and contract classes', () => {
  ['tab-data', 'tab-mapping', 'tab-style', 'tab-annotate', 'tab-export'].forEach((id) => {
    assert.match(index, new RegExp(`id="${id}"`));
  });
  assert.match(index, /class="[^"]*common-data-tab/);
  assert.match(index, /class="[^"]*common-export-tab/);
  assert.match(index, /data-dvz-setting-sidebar/);
});

test('shared libraries are referenced only through versioned aliases on the id host', () => {
  const urls = [...(index + share).matchAll(/https:\/\/[^"']+\/lib\/[^"']+/g)].map((m) => m[0]);
  assert.ok(urls.length > 5);
  urls.forEach((url) => {
    assert.match(url, /^https:\/\/id\.data-viz-lectures\.com\/lib\/[\w-]+\.v1\.(js|css)$/, url);
  });
  assert.match(index, /supabase\.v1\.js[\s\S]*dataviz-auth-client\.v1\.js[\s\S]*dataviz-tool-header\.v1\.js/);
  assert.match(share, /settings-compat\.v1\.js/);
});

test('identity: gaId, appName, share table and function', () => {
  const helpers = read('js/dvz-helpers.js');
  assert.match(helpers, /gaId: 'G-7NYMBRBRWZ'/);
  assert.match(helpers, /appName: 'weighted-directed-flow-map'/);
  assert.match(helpers, /shareTable: 'weighted_directed_flow_map_shares'/);
  assert.match(helpers, /publishFunction: 'publish-weighted-directed-flow-map-share'/);
  assert.match(read('supabase/functions/publish-weighted-directed-flow-map-share/index.ts'), /SHARE_TABLE = "weighted_directed_flow_map_shares"/);
});

test('layout rules: explicit grid rows and 96px viewer selects', () => {
  assert.match(css, /#dvz-chart > #chart-title \{ grid-row: 1; \}/);
  assert.match(css, /#dvz-chart > #dvz-controls \{ grid-row: 3; \}/);
  assert.match(css, /--dvz-control-select-width: 96px/);
  assert.doesNotMatch(css, /\.dvz-control-select \{\s*width: 180px/);
});

test('no direct client writes to the share table; projectId is the launch parameter', () => {
  assert.doesNotMatch(allJs, /_shares['"]\)\s*\.insert/);
  assert.doesNotMatch(allJs, /project_id['"]\)/);
  assert.match(allJs, /get\('projectId'\)/);
});

test('annotation defaults stay empty in code (sample titles come from the catalog)', () => {
  assert.doesNotMatch(read('js/settings-spec.js'), /annotateTitle: \{ type: 'string', default: '[^']+'/);
});
