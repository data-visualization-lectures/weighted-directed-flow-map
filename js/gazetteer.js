(function (root) {
  'use strict';

  // Name -> place resolution against bundled gazetteers. Matching is equality on
  // normalised keys only: no substring or fuzzy matching, so 京都 never hits 東京.

  const KINDS = ['jp-prefectures', 'world-countries', 'world-cities'];
  const PREFIX = {
    'jp-prefectures': 'jp',
    'world-countries': 'cty',
    'world-cities': 'city',
  };

  function nfkc(value) {
    const s = value == null ? '' : String(value);
    return typeof s.normalize === 'function' ? s.normalize('NFKC') : s;
  }

  function stripLatinDiacritics(s) {
    // Only Latin combining marks; Japanese dakuten (U+3099/309A) must survive.
    return typeof s.normalize === 'function'
      ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
      : s;
  }

  function normalizeName(value) {
    let s = nfkc(value)
      .replace(/[​-‍﻿]/g, '')
      .trim()
      .replace(/\s*[（(]?\d{1,2}[)）]$/, '')
      .replace(/[*※†]+$/, '')
      .trim();
    s = stripLatinDiacritics(s).toLowerCase();
    s = s
      .replace(/&/g, ' and ')
      .replace(/[.,'’`"“”]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^the /, '');
    return s;
  }

  // Short forms for Japanese prefectures (東京都 -> 東京), never for 北海道.
  function prefectureShortForms(ja) {
    const name = nfkc(ja).trim();
    if (!name || name === '北海道') return [];
    const m = name.match(/^(.{2,})[都道府県]$/);
    return m ? [m[1]] : [];
  }

  const EN_PREF_SUFFIX_RE = /\s+(prefecture|pref|ken|fu|to|do|metropolis)$/;

  function englishPrefectureForms(en) {
    const n = normalizeName(en).replace(/-/g, ' ');
    const out = new Set([n]);
    const stripped = n.replace(EN_PREF_SUFFIX_RE, '').trim();
    if (stripped) out.add(stripped);
    out.add(n.replace(/\s+/g, ''));
    return [...out].filter(Boolean);
  }

  function entryNodeId(kind, entry) {
    return `${PREFIX[kind]}:${entry.id}`;
  }

  /**
   * Builds lookup maps for one gazetteer dataset {kind, entries}.
   * strict keys: official names, alternates and codes. loose keys: short forms.
   */
  function createIndex(dataset) {
    const kind = dataset.kind;
    const strict = new Map();
    const loose = new Map();
    const codes = new Map();
    const byId = new Map();
    const add = (map, key, entry) => {
      if (!key) return;
      const list = map.get(key) || [];
      if (!list.includes(entry)) list.push(entry);
      map.set(key, list);
    };
    (dataset.entries || []).forEach((entry) => {
      byId.set(String(entry.id), entry);
      const names = [entry.ja, entry.en, ...(entry.jaAlt || []), ...(entry.enAlt || [])].filter(Boolean);
      names.forEach((name) => add(strict, normalizeName(name), entry));
      if (kind === 'jp-prefectures') {
        [entry.en, ...(entry.enAlt || [])].filter(Boolean).forEach((en) => {
          englishPrefectureForms(en).forEach((key) => add(strict, key, entry));
        });
        prefectureShortForms(entry.ja).forEach((short) => add(loose, normalizeName(short), entry));
      }
      (entry.codes || []).forEach((code) => add(codes, normalizeName(code), entry));
    });

    function codeLookup(n, opts) {
      if (/^\d+$/.test(n)) {
        if (kind === 'jp-prefectures') {
          const hit = codes.get(n) || codes.get(String(Number(n)));
          return hit || null;
        }
        if (kind === 'world-countries' && opts.numericCodes) return codes.get(n.padStart(3, '0')) || null;
        // 5/6-digit 地方公共団体コード for Japanese cities.
        if (kind === 'world-cities' && /^\d{5,6}$/.test(n)) return codes.get(n) || null;
        return null;
      }
      if (/^[a-z]{2,3}$/.test(n) && kind !== 'jp-prefectures') return codes.get(n) || null;
      if (/^jp-\d{2}$/.test(n) && kind === 'jp-prefectures') return codes.get(n) || null;
      return null;
    }

    function result(list, via) {
      if (!list || !list.length) return null;
      if (list.length > 1) return { status: 'ambiguous', candidates: list.map((e) => entryNodeId(kind, e)), entries: list, via };
      return { status: 'ok', entry: list[0], via };
    }

    /**
     * opts.strictOnly: skip short forms (used for the secondary pass).
     * opts.countryOf(label) -> iso2 for qualifier support ("San Jose, US").
     */
    function lookup(label, opts = {}) {
      const n = normalizeName(label);
      if (!n) return { status: 'none' };
      const viaCode = result(codeLookup(n, opts), 'code');
      if (viaCode) return viaCode;
      const viaName = result(strict.get(n), 'name') || (!opts.strictOnly && result(loose.get(n), 'short'));
      if (viaName) return viaName;
      if (kind === 'world-cities' && typeof opts.countryOf === 'function') {
        const m = nfkc(label).match(/^(.+?)\s*(?:,\s*([^,]+)|[（(]([^)）]+)[)）])$/);
        if (m) {
          const base = normalizeName(m[1]);
          const iso2 = opts.countryOf(m[2] || m[3]);
          const list = (strict.get(base) || []).filter((e) => e.country === iso2);
          const hit = result(list, 'qualified');
          if (hit) return hit;
        }
      }
      return { status: 'none' };
    }

    return {
      kind,
      prefix: PREFIX[kind],
      size: byId.size,
      lookup,
      getById: (id) => byId.get(String(id)) || null,
      nodeIdOf: (entry) => entryNodeId(kind, entry),
    };
  }

  function okRate(labels, index, opts) {
    if (!labels.length || !index) return 0;
    let ok = 0;
    labels.forEach((label) => {
      if (index.lookup(label, opts).status === 'ok') ok += 1;
    });
    return ok / labels.length;
  }

  // Picks the gazetteer that resolves the most labels. Ties: jp > countries > cities.
  function chooseAuto(labels, indexes, opts = {}) {
    const perKind = {};
    let best = null;
    KINDS.forEach((kind) => {
      const index = indexes[kind];
      if (!index) return;
      const rate = okRate(labels, index, opts);
      perKind[kind] = rate;
      if (!best || rate > best.rate + 1e-9) best = { kind, rate };
    });
    return { kind: best ? best.kind : null, rate: best ? best.rate : 0, perKind };
  }

  function makeNode(kind, entry, index, lang) {
    const label = lang === 'en' ? (entry.en || entry.ja) : (entry.ja || entry.en);
    return {
      id: index.nodeIdOf(entry),
      label,
      labelJa: entry.ja || entry.en,
      labelEn: entry.en || entry.ja,
      lat: entry.lat,
      lon: entry.lon,
      kind,
      code: entry.iso2 || (kind === 'jp-prefectures' ? entry.id : null),
    };
  }

  function findNodeById(nodeId, indexes, lang) {
    const [prefix, ...rest] = String(nodeId || '').split(':');
    const id = rest.join(':');
    for (const kind of KINDS) {
      const index = indexes[kind];
      if (!index || index.prefix !== prefix) continue;
      const entry = index.getById(id);
      if (entry) return makeNode(kind, entry, index, lang);
    }
    return null;
  }

  /**
   * Returns { resolve(label) -> {status, node?, candidates?, secondary?}, info }.
   * mode: auto | jp-prefectures | world-countries | world-cities | coordinates
   */
  function createResolver({ mode = 'auto', indexes = {}, labels = [], overrides = {}, coordsByLabel = null, lang = 'ja' } = {}) {
    const countryIndex = indexes['world-countries'];
    const countryOf = (text) => {
      if (!countryIndex) return null;
      const res = countryIndex.lookup(text);
      return res.status === 'ok' ? res.entry.iso2 : null;
    };
    const coords = coordsByLabel instanceof Map ? coordsByLabel : new Map();
    let primary = null;
    let perKind = {};
    if (mode === 'auto') {
      const unresolvedByCoords = labels.filter((l) => !coords.has(l));
      const pick = chooseAuto(unresolvedByCoords.length ? unresolvedByCoords : labels, indexes, { countryOf });
      perKind = pick.perKind;
      primary = pick.rate > 0 ? pick.kind : null;
      if (!primary && coords.size) primary = 'coordinates';
    } else if (mode !== 'coordinates') {
      primary = indexes[mode] ? mode : null;
    } else {
      primary = 'coordinates';
    }
    const opts = { countryOf, numericCodes: mode === 'world-countries' };

    function resolve(label) {
      const key = normalizeName(label);
      if (overrides && overrides[key]) {
        const node = findNodeById(overrides[key], indexes, lang);
        if (node) return { status: 'ok', node, override: true };
      }
      const c = coords.get(label);
      if (c) {
        return {
          status: 'ok',
          node: { id: `pt:${key}`, label: nfkc(label).trim(), labelJa: label, labelEn: label, lat: c.lat, lon: c.lon, kind: 'point' },
        };
      }
      if (primary === 'coordinates' && mode === 'coordinates') return { status: 'none' };
      let ambiguous = null;
      if (primary && indexes[primary]) {
        const res = indexes[primary].lookup(label, opts);
        if (res.status === 'ok') return { status: 'ok', node: makeNode(primary, res.entry, indexes[primary], lang) };
        if (res.status === 'ambiguous') ambiguous = { status: 'ambiguous', candidates: res.candidates };
      }
      if (mode === 'auto') {
        for (const kind of KINDS) {
          if (kind === primary || !indexes[kind]) continue;
          const res = indexes[kind].lookup(label, { ...opts, strictOnly: true });
          if (res.status === 'ok') {
            return { status: 'ok', node: makeNode(kind, res.entry, indexes[kind], lang), secondary: true };
          }
          if (res.status === 'ambiguous' && !ambiguous) ambiguous = { status: 'ambiguous', candidates: res.candidates };
        }
      }
      return ambiguous || { status: 'none' };
    }

    return { resolve, info: { mode, primary, perKind } };
  }

  // Share of labels any gazetteer can resolve; used by format detection.
  function geoRate(labels, indexes) {
    const list = (labels || []).filter((l) => l != null && String(l).trim());
    if (!list.length) return 0;
    return Math.max(0, ...KINDS.map((kind) => okRate(list, indexes[kind], {})));
  }

  const cache = new Map();
  function load(kind, base) {
    const url = `${base || 'data/gazetteer/'}${kind}.json`;
    if (!cache.has(url)) {
      cache.set(url, fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
        return res.json();
      }).then((json) => createIndex({ ...json, kind })).catch((error) => {
        cache.delete(url);
        throw error;
      }));
    }
    return cache.get(url);
  }

  async function loadAll(base) {
    const out = {};
    const results = await Promise.allSettled(KINDS.map((kind) => load(kind, base)));
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') out[KINDS[i]] = res.value;
    });
    return out;
  }

  root.FlowGazetteer = {
    KINDS,
    normalizeName,
    prefectureShortForms,
    createIndex,
    chooseAuto,
    createResolver,
    findNodeById,
    geoRate,
    load,
    loadAll,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.FlowGazetteer;
}
