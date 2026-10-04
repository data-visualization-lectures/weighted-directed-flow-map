(function (root) {
  'use strict';

  const CHART_TYPE = 'weighted-directed-flow-map';

  const GAZETTEER_KINDS = ['jp-prefectures', 'world-countries', 'world-cities'];
  const COLOR_SCHEMES = ['blues', 'oranges', 'greens', 'purples', 'viridis', 'inferno'];
  const FLOW_SHAPES = ['arrow', 'tapered', 'tapered-arrow', 'tapered-centerline'];

  const nullableString = () => ({ type: 'string', default: null, nullable: true });

  // Types, defaults and ranges live only here. The sidebar and #dvz-controls read
  // defaults through defaultSettings(); they never declare their own.
  const SETTINGS_SPEC = {
    version: 1,
    chartType: CHART_TYPE,
    fields: {
      // Mapping
      inputFormat: { type: 'enum', default: 'auto', values: ['auto', 'edge-list', 'od-matrix'] },
      fromColumn: nullableString(),
      toColumn: nullableString(),
      valueColumn: nullableString(),
      valueMode: { type: 'enum', default: 'column', values: ['column', 'count'] },
      fromLatColumn: nullableString(),
      fromLonColumn: nullableString(),
      toLatColumn: nullableString(),
      toLonColumn: nullableString(),
      groupColumn: nullableString(),
      matrixLabelColumn: nullableString(),
      matrixOrientation: { type: 'enum', default: 'rows-origin', values: ['rows-origin', 'cols-origin'] },
      excludeTotals: { type: 'boolean', default: true },
      gazetteer: { type: 'enum', default: 'auto', values: ['auto', ...GAZETTEER_KINDS, 'coordinates'] },
      nodeOverrides: { type: 'object', default: {} },

      // Internal snapshot of what detection chose when the data was loaded.
      detectedFormat: { type: 'enum', default: 'none', values: ['none', 'edge-list', 'od-matrix'] },
      detectedGazetteer: { type: 'enum', default: 'none', values: ['none', ...GAZETTEER_KINDS, 'coordinates'] },

      // Style
      basemap: { type: 'enum', default: 'auto', values: ['auto', 'world', 'japan', 'none'] },
      projection: {
        type: 'enum',
        default: 'auto',
        values: ['auto', 'natural-earth', 'equal-earth', 'mercator', 'conic-conformal'],
      },
      centerLongitudeMode: { type: 'enum', default: 'auto', values: ['auto', 'manual'] },
      centerLongitude: { type: 'number', default: 0, min: -180, max: 180 },
      extent: { type: 'enum', default: 'nodes', values: ['nodes', 'basemap'] },
      okinawaInset: { type: 'boolean', default: false },
      flowShape: { type: 'enum', default: 'arrow', values: FLOW_SHAPES },
      curvature: { type: 'number', default: 0.2, min: 0, max: 0.6 },
      maxWidth: { type: 'number', default: 16, min: 1, max: 60 },
      minWidth: { type: 'number', default: 0.75, min: 0, max: 10 },
      widthScale: { type: 'enum', default: 'linear', values: ['linear', 'sqrt'] },
      topN: { type: 'number', default: 100, min: 1, max: 10000 },
      keepPairs: { type: 'boolean', default: true },
      minValue: { type: 'number', default: 0, min: 0, max: 1e15 },
      colorMode: {
        type: 'enum',
        default: 'single',
        values: ['single', 'value', 'asymmetry', 'origin', 'destination'],
      },
      flowColor: { type: 'string', default: '#2563eb' },
      colorScheme: { type: 'enum', default: 'blues', values: COLOR_SCHEMES },
      flowOpacity: { type: 'number', default: 0.8, min: 0.1, max: 1 },
      nodeSizeBy: { type: 'enum', default: 'total', values: ['none', 'total', 'in', 'out'] },
      nodeMaxRadius: { type: 'number', default: 8, min: 2, max: 40 },
      nodeColorMode: { type: 'enum', default: 'net', values: ['single', 'net'] },
      labelMode: { type: 'enum', default: 'top', values: ['none', 'top', 'all'] },
      labelTopN: { type: 'number', default: 10, min: 1, max: 200 },

      // Annotate
      annotateTitle: { type: 'string', default: '' },
      annotateSource: { type: 'string', default: '' },
      annotateSourceUrl: { type: 'string', default: '' },
      valueUnit: { type: 'string', default: '' },
      legendPosition: {
        type: 'enum',
        default: 'bottom-right',
        values: ['none', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
      },

      // #dvz-controls: saved as the author's initial view.
      focusNode: nullableString(),
      focusDirection: { type: 'enum', default: 'both', values: ['both', 'out', 'in'] },
      flowMode: { type: 'enum', default: 'gross', values: ['gross', 'net'] },
      groupValue: nullableString(),
    },
    migrations: [],
  };

  const SIDEBAR_SPEC = {
    tabs: [
      { id: 'tab-data', label: { ja: 'データ', en: 'Data' } },
      { id: 'tab-mapping', label: { ja: 'マッピング', en: 'Mapping' } },
      { id: 'tab-style', label: { ja: 'スタイル', en: 'Style' } },
      { id: 'tab-annotate', label: { ja: '注釈', en: 'Annotate' } },
      { id: 'tab-export', label: { ja: '出力', en: 'Export' } },
    ],
  };

  // Every field has exactly one writer.
  const FIELD_OWNERS = {
    'tab-mapping': [
      'inputFormat', 'fromColumn', 'toColumn', 'valueColumn', 'valueMode',
      'fromLatColumn', 'fromLonColumn', 'toLatColumn', 'toLonColumn', 'groupColumn',
      'matrixLabelColumn', 'matrixOrientation', 'excludeTotals', 'gazetteer', 'nodeOverrides',
    ],
    internal: ['detectedFormat', 'detectedGazetteer'],
    'tab-style': [
      'basemap', 'projection', 'centerLongitudeMode', 'centerLongitude', 'extent', 'okinawaInset',
      'flowShape', 'curvature', 'maxWidth', 'minWidth', 'widthScale', 'topN', 'keepPairs', 'minValue',
      'colorMode', 'flowColor', 'colorScheme', 'flowOpacity', 'nodeSizeBy', 'nodeMaxRadius',
      'nodeColorMode', 'labelMode', 'labelTopN',
    ],
    'tab-annotate': ['annotateTitle', 'annotateSource', 'annotateSourceUrl', 'valueUnit', 'legendPosition'],
    controls: ['focusNode', 'focusDirection', 'flowMode', 'groupValue'],
  };

  const CONTROL_KEYS = FIELD_OWNERS.controls.slice();
  const INTERNAL_KEYS = FIELD_OWNERS.internal.slice();
  const MAPPING_KEYS = FIELD_OWNERS['tab-mapping'].slice();

  function cloneDefault(value) {
    if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
    return value;
  }

  function defaultSettings() {
    const out = {};
    Object.entries(SETTINGS_SPEC.fields).forEach(([key, spec]) => {
      out[key] = cloneDefault(spec.default);
    });
    return out;
  }

  const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const COLUMN_KEYS = [
    'fromColumn', 'toColumn', 'valueColumn', 'fromLatColumn', 'fromLonColumn',
    'toLatColumn', 'toLonColumn', 'groupColumn', 'matrixLabelColumn',
  ];

  // Cross-field rules that DVZSettingsCompat cannot express.
  // `columns` is optional; when given, column settings that no longer exist are cleared.
  function sanitizeSettings(input, columns) {
    const defaults = defaultSettings();
    const s = { ...defaults, ...(input || {}) };
    Object.entries(SETTINGS_SPEC.fields).forEach(([key, spec]) => {
      const value = s[key];
      if (spec.type === 'number') {
        const n = Number(value);
        s[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : defaults[key];
      } else if (spec.type === 'enum') {
        if (!spec.values.includes(value)) s[key] = defaults[key];
      } else if (spec.type === 'boolean') {
        if (typeof value !== 'boolean') s[key] = defaults[key];
      } else if (spec.type === 'string') {
        if (value == null) s[key] = spec.nullable ? null : defaults[key];
        else if (typeof value !== 'string') s[key] = defaults[key];
      } else if (spec.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) s[key] = defaults[key];
      }
    });
    if (s.minWidth > s.maxWidth) s.minWidth = s.maxWidth;
    if (!HEX_RE.test(String(s.flowColor || ''))) s.flowColor = defaults.flowColor;
    if (s.labelTopN > s.topN) s.labelTopN = s.topN;
    const overrides = {};
    Object.entries(s.nodeOverrides || {}).forEach(([label, id]) => {
      if (typeof id === 'string' && id) overrides[label] = id;
    });
    s.nodeOverrides = overrides;
    if (Array.isArray(columns)) {
      const known = new Set(columns);
      COLUMN_KEYS.forEach((key) => {
        if (s[key] != null && !known.has(s[key])) s[key] = null;
      });
    }
    return s;
  }

  function tabLabel(tabId, lang) {
    const tab = SIDEBAR_SPEC.tabs.find((item) => item.id === tabId);
    if (!tab) return tabId;
    return tab.label[lang === 'en' ? 'en' : 'ja'];
  }

  root.FlowMapSettings = {
    CHART_TYPE,
    SETTINGS_SPEC,
    SIDEBAR_SPEC,
    FIELD_OWNERS,
    CONTROL_KEYS,
    INTERNAL_KEYS,
    MAPPING_KEYS,
    COLUMN_KEYS,
    FLOW_SHAPES,
    defaultSettings,
    sanitizeSettings,
    tabLabel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.FlowMapSettings;
}
