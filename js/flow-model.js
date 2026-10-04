(function (root) {
  'use strict';

  // Pure data pipeline: table rows -> directed weighted flows. No DOM, no d3.

  const MISSING_MARKERS = new Set(['', '…', '...', 'x', 'X', '*', '**', '***', '—', '―', 'ー', 'NA', 'N/A', 'n/a', 'null', 'NULL']);
  const TOTAL_RE = /^(合計|総計|総数|計|小計|全国|全国計|都道府県計|grand\s*total|total|sum|subtotal|all)$/i;
  const AGGREGATE_RE = /^(世界|world|総額|全世界|eu|ue|asean|apec|oecd|中東|アジア|asia|欧州|ヨーロッパ|europe|北米|north\s*america|中南米|latin\s*america|アフリカ|africa|大洋州|oceania|その他.*|other.*|others|unknown|不明|不詳|国外)$/i;
  const CODE_HEADER_RE = /(code|コード|^id$|番号)$/i;

  const ALIASES = {
    from: {
      en: ['from', 'source', 'src', 'origin', 'orig', 'o', 'start', 'departure', 'sender', 'reporter'],
      ja: ['出発', '出発地', '発地', '発', '起点', '元', '移動元', '移動前', '移動前の住所地', '転出元', '転出地', '前住地', '出身地', '出荷元', '送り元'],
    },
    to: {
      en: ['to', 'target', 'dst', 'dest', 'destination', 'd', 'end', 'arrival', 'receiver', 'partner'],
      ja: ['到着', '到着地', '着地', '着', '終点', '先', '移動先', '移動後', '移動後の住所地', '転入先', '転入地', '現住地', '行き先', '行先', '目的地', '出荷先', '送り先'],
    },
    value: {
      en: ['value', 'weight', 'count', 'flow', 'flows', 'volume', 'amount', 'n', 'qty', 'quantity', 'trips', 'people', 'persons', 'migrants', 'total'],
      ja: ['値', '数', '数量', '量', '人数', '人', '件数', '移動者数', '転入者数', '転出者数', '流動量', '金額', '価額', '輸出額', '輸入額', '重み', '台数', '回数'],
    },
    group: {
      en: ['group', 'period', 'year', 'yr', 'date', 'time', 'month', 'category', 'type', 'class', 'series', 'mode', 'segment'],
      ja: ['グループ', '期間', '年', '年次', '年度', '時点', '月', '区分', '種別', '分類', 'カテゴリ', 'カテゴリー', '品目', '手段', '系列'],
    },
  };
  const COORD_PREFIX = {
    from: ['from', 'origin', 'orig', 'o', 'src', 'source', 'start', '出発地', '出発', '発地', '発', '起点', '元'],
    to: ['to', 'dest', 'destination', 'd', 'dst', 'target', 'end', '到着地', '到着', '着地', '着', '終点', '先'],
  };
  const LAT_TOKENS = ['latitude', 'lat', '緯度'];
  const LON_TOKENS = ['longitude', 'long', 'lng', 'lon', '経度'];

  function nfkc(value) {
    const s = value == null ? '' : String(value);
    return typeof s.normalize === 'function' ? s.normalize('NFKC') : s;
  }

  // Returns a finite number, null for "missing" markers, or NaN for invalid text.
  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (value == null) return null;
    const s = nfkc(value).trim();
    if (MISSING_MARKERS.has(s)) return null;
    // In Japanese official statistics "-" means 該当数字なし (zero).
    if (s === '-' || s === '−' || s === '–') return 0;
    const cleaned = s.replace(/[,\s]/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return NaN;
    return Number(cleaned);
  }

  // Normalised header used for alias matching.
  function normHeader(value) {
    return nfkc(value)
      .toLowerCase()
      .trim()
      .replace(/[（(][^）)]*[）)]\s*$/, '')
      .replace(/[\s_\-.・:：/]+/g, '')
      .trim();
  }

  function headerTokens(value) {
    return nfkc(value)
      .toLowerCase()
      .replace(/[（(][^）)]*[）)]\s*$/, '')
      .split(/[\s_\-.・:：/]+/)
      .filter(Boolean);
  }

  const NORM_ALIASES = {};
  Object.entries(ALIASES).forEach(([role, set]) => {
    NORM_ALIASES[role] = {
      en: set.en.map(normHeader),
      ja: set.ja.map(normHeader),
    };
  });

  // 2 = exact alias, 1 = token / prefix match, 0 = no match.
  function aliasScore(header, role) {
    const joined = normHeader(header);
    if (!joined) return 0;
    const set = NORM_ALIASES[role];
    if (set.en.includes(joined) || set.ja.includes(joined)) return 2;
    const tokens = headerTokens(header);
    if (tokens.some((tok) => tok.length > 1 && set.en.includes(tok))) return 1;
    if (set.ja.some((alias) => alias.length >= 2 && (joined.startsWith(alias) || joined.endsWith(alias)))) return 1;
    return 0;
  }

  function isTotalLabel(value) {
    return TOTAL_RE.test(nfkc(value).trim());
  }

  function isAggregateLabel(value) {
    return AGGREGATE_RE.test(nfkc(value).trim());
  }

  function isCodeHeader(value) {
    return CODE_HEADER_RE.test(nfkc(value).trim());
  }

  // Detects coordinate columns like from_lat, lat_o, 出発地緯度. Returns {role, axis} or null.
  function coordinateRole(header) {
    const joined = normHeader(header);
    if (!joined) return null;
    const axes = [['lat', LAT_TOKENS], ['lon', LON_TOKENS]];
    for (const [axis, tokens] of axes) {
      for (const token of tokens) {
        let rest = null;
        if (joined.endsWith(token)) rest = joined.slice(0, joined.length - token.length);
        else if (joined.startsWith(token)) rest = joined.slice(token.length);
        if (rest == null || !rest) continue;
        for (const role of ['from', 'to']) {
          if (COORD_PREFIX[role].includes(rest)) return { role, axis };
        }
      }
    }
    return null;
  }

  function columnsOf(rows) {
    if (Array.isArray(rows?.columns)) return rows.columns.slice();
    return rows && rows[0] ? Object.keys(rows[0]) : [];
  }

  function profileColumns(rows, columns, sampleSize = 500) {
    const sample = rows.slice(0, sampleSize);
    const out = {};
    columns.forEach((col) => {
      let nonEmpty = 0;
      let numeric = 0;
      const distinct = new Set();
      sample.forEach((row) => {
        const raw = row[col];
        const s = raw == null ? '' : nfkc(raw).trim();
        if (s === '') return;
        nonEmpty += 1;
        distinct.add(s);
        const n = parseNumber(s);
        if (n === null || Number.isFinite(n)) numeric += 1;
      });
      out[col] = {
        nonEmpty,
        numericRate: nonEmpty ? numeric / nonEmpty : 0,
        distinct,
        isCode: isCodeHeader(col),
      };
    });
    return out;
  }

  function normLabel(value) {
    return nfkc(value).trim().toLowerCase();
  }

  function jaccard(a, b) {
    const A = new Set([...a].map(normLabel));
    const B = new Set([...b].map(normLabel));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((v) => { if (B.has(v)) inter += 1; });
    return inter / (A.size + B.size - inter);
  }

  function bestAlias(columns, role, exclude) {
    let best = null;
    let bestScore = 0;
    columns.forEach((col) => {
      if (exclude.has(col)) return;
      const score = aliasScore(col, role);
      if (score > bestScore) {
        best = col;
        bestScore = score;
      }
    });
    return best;
  }

  function inferCoordinateColumns(columns, profile) {
    const out = { fromLatColumn: null, fromLonColumn: null, toLatColumn: null, toLonColumn: null };
    columns.forEach((col) => {
      const role = coordinateRole(col);
      if (!role) return;
      if ((profile[col]?.numericRate || 0) < 0.9) return;
      const key = `${role.role}${role.axis === 'lat' ? 'Lat' : 'Lon'}Column`;
      if (!out[key]) out[key] = col;
    });
    return out;
  }

  function inferGroupColumn(columns, profile, exclude) {
    for (const col of columns) {
      if (exclude.has(col)) continue;
      if (!aliasScore(col, 'group')) continue;
      const size = profile[col]?.distinct?.size || 0;
      if (size >= 2 && size <= 200) return col;
    }
    return null;
  }

  function inferEdgeMapping(columns, profile, base = {}) {
    const coords = inferCoordinateColumns(columns, profile);
    const used = new Set(Object.values(coords).filter(Boolean));
    const from = base.fromColumn || bestAlias(columns, 'from', used);
    if (from) used.add(from);
    const to = base.toColumn || bestAlias(columns, 'to', used);
    if (to) used.add(to);
    const group = inferGroupColumn(columns, profile, used);
    if (group) used.add(group);
    const numericCols = columns.filter((col) => !used.has(col)
      && !profile[col]?.isCode
      && (profile[col]?.numericRate || 0) >= 0.8);
    const value = bestAlias(numericCols, 'value', new Set()) || numericCols[0] || null;
    return {
      fromColumn: from,
      toColumn: to,
      valueColumn: value,
      valueMode: value ? 'column' : 'count',
      groupColumn: group,
      ...coords,
    };
  }

  function pickLabelColumn(columns, profile) {
    if (!columns.length) return null;
    const first = columns[0];
    if ((profile[first]?.numericRate || 0) < 0.5) return first;
    return columns.find((col) => (profile[col]?.numericRate || 0) < 0.5) || null;
  }

  function matrixDestColumns(columns, profile, labelCol, excludeTotals = true) {
    return columns.filter((col) => col !== labelCol
      && !(excludeTotals && isTotalLabel(col))
      && !profile[col]?.isCode
      && !aliasScore(col, 'group')
      && (profile[col]?.numericRate || 0) >= 0.8);
  }

  /**
   * Detects whether the table is an edge list or an OD matrix.
   * opts.geoRate(labels) -> share of labels a gazetteer can resolve (optional).
   */
  function detectFormat(rows, columns, opts = {}) {
    const cols = columns || columnsOf(rows);
    const profile = profileColumns(rows, cols);
    const geoRate = typeof opts.geoRate === 'function' ? opts.geoRate : () => 0;
    const reasons = [];
    if (!rows.length || cols.length < 2) {
      return { format: 'unknown', confidence: 'none', reasons: ['empty'], profile };
    }

    const coords = inferCoordinateColumns(cols, profile);
    const coordSet = new Set(Object.values(coords).filter(Boolean));
    const fromAlias = bestAlias(cols, 'from', coordSet);
    const toAlias = fromAlias ? bestAlias(cols, 'to', new Set([...coordSet, fromAlias])) : null;
    if (fromAlias && toAlias) {
      reasons.push('from/to aliases');
      return { format: 'edge-list', confidence: 'high', reasons, profile };
    }

    const labelCol = pickLabelColumn(cols, profile);
    if (labelCol != null) {
      const dest = matrixDestColumns(cols, profile, labelCol, true);
      if (dest.length >= 2) {
        const rowLabels = rows.map((row) => row[labelCol]).filter((v) => v != null && String(v).trim() && !isTotalLabel(v));
        const R = new Set(rowLabels.map(normLabel));
        const C = new Set(dest.map(normLabel));
        let inter = 0;
        C.forEach((v) => { if (R.has(v)) inter += 1; });
        const overlap = Math.min(R.size, C.size) ? inter / Math.min(R.size, C.size) : 0;
        const headerGeo = geoRate(dest);
        if (overlap >= 0.5 || headerGeo >= 0.6) {
          reasons.push(overlap >= 0.5 ? 'row/column labels overlap' : 'column headers are places');
          return { format: 'od-matrix', confidence: 'high', reasons, profile, labelColumn: labelCol };
        }
      }
    }

    const textCols = cols.filter((col) => !coordSet.has(col) && (profile[col]?.numericRate || 0) < 0.5 && !aliasScore(col, 'group'));
    const numCols = cols.filter((col) => !coordSet.has(col) && (profile[col]?.numericRate || 0) >= 0.8);
    if (textCols.length >= 2 && numCols.length >= 1) {
      let best = null;
      for (let i = 0; i < textCols.length; i += 1) {
        for (let j = i + 1; j < textCols.length; j += 1) {
          const a = profile[textCols[i]].distinct;
          const b = profile[textCols[j]].distinct;
          const score = jaccard(a, b);
          const geo = Math.min(geoRate([...a]), geoRate([...b]));
          if (score >= 0.3 || geo >= 0.6) {
            const total = score + geo;
            if (!best || total > best.total) best = { total, from: textCols[i], to: textCols[j] };
          }
        }
      }
      if (best) {
        reasons.push('two place-like text columns');
        return { format: 'edge-list', confidence: 'low', reasons, profile, fromColumn: best.from, toColumn: best.to };
      }
    }
    return { format: 'unknown', confidence: 'none', reasons: ['no pattern'], profile };
  }

  /**
   * Fills in mapping settings for the detected format. Returns a partial settings object.
   */
  function inferMapping(rows, columns, detection) {
    const cols = columns || columnsOf(rows);
    const profile = detection?.profile || profileColumns(rows, cols);
    if (detection?.format === 'od-matrix') {
      return {
        matrixLabelColumn: detection.labelColumn ?? pickLabelColumn(cols, profile),
        fromColumn: null,
        toColumn: null,
        valueColumn: null,
        groupColumn: null,
        fromLatColumn: null,
        fromLonColumn: null,
        toLatColumn: null,
        toLonColumn: null,
      };
    }
    const mapping = inferEdgeMapping(cols, profile, {
      fromColumn: detection?.fromColumn || null,
      toColumn: detection?.toColumn || null,
    });
    return { ...mapping, matrixLabelColumn: null };
  }

  function emptyIssues() {
    return {
      rows: 0,
      missingValues: 0,
      invalidValues: 0,
      invalidExamples: [],
      negativeValues: 0,
      zeroValues: 0,
      totalsExcluded: 0,
      blankLabels: 0,
      coordinateConflicts: [],
      invalidCoordinates: 0,
    };
  }

  function parseCoord(lat, lon) {
    const la = parseNumber(lat);
    const lo = parseNumber(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    if (la === 0 && lo === 0) return null;
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) return { invalid: true };
    return { lat: la, lon: lo };
  }

  function haversineKm(a, b) {
    const toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLon = (b.lon - a.lon) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Converts rows to raw edges (labels, not yet resolved).
   * Returns { edges: [{from, to, value, group}], coordsByLabel: Map, issues }.
   */
  function toEdges(rows, settings, format) {
    const issues = emptyIssues();
    const edges = [];
    const coordsByLabel = new Map();
    const pushValue = (from, to, raw, group) => {
      const value = settings.valueMode === 'count' && format === 'edge-list' ? 1 : parseNumber(raw);
      if (value === null) { issues.missingValues += 1; return; }
      if (Number.isNaN(value)) {
        issues.invalidValues += 1;
        if (issues.invalidExamples.length < 5) issues.invalidExamples.push(String(raw));
        return;
      }
      if (value < 0) { issues.negativeValues += 1; return; }
      if (value === 0) { issues.zeroValues += 1; return; }
      edges.push({ from, to, value, group });
    };
    const label = (v) => (v == null ? '' : nfkc(v).trim());
    const excludeTotals = settings.excludeTotals !== false;

    if (format === 'od-matrix') {
      const cols = columnsOf(rows);
      const labelCol = settings.matrixLabelColumn != null && cols.includes(settings.matrixLabelColumn)
        ? settings.matrixLabelColumn
        : pickLabelColumn(cols, profileColumns(rows, cols));
      if (labelCol == null) return { edges, coordsByLabel, issues };
      const profile = profileColumns(rows, cols);
      const dest = matrixDestColumns(cols, profile, labelCol, excludeTotals);
      if (excludeTotals) issues.totalsExcluded += cols.filter((c) => c !== labelCol && isTotalLabel(c)).length;
      const colsOrigin = settings.matrixOrientation === 'cols-origin';
      rows.forEach((row) => {
        issues.rows += 1;
        const rowLabel = label(row[labelCol]);
        if (!rowLabel) { issues.blankLabels += 1; return; }
        if (excludeTotals && isTotalLabel(rowLabel)) { issues.totalsExcluded += 1; return; }
        dest.forEach((col) => {
          const colLabel = label(col);
          if (colsOrigin) pushValue(colLabel, rowLabel, row[col], '');
          else pushValue(rowLabel, colLabel, row[col], '');
        });
      });
      return { edges, coordsByLabel, issues };
    }

    const fromCol = settings.fromColumn;
    const toCol = settings.toColumn;
    if (fromCol == null || toCol == null) return { edges, coordsByLabel, issues };
    const groupCol = settings.groupColumn;
    const coordCols = {
      from: [settings.fromLatColumn, settings.fromLonColumn],
      to: [settings.toLatColumn, settings.toLonColumn],
    };
    const noteCoord = (name, cols, row) => {
      if (cols[0] == null || cols[1] == null) return;
      const c = parseCoord(row[cols[0]], row[cols[1]]);
      if (!c) return;
      if (c.invalid) { issues.invalidCoordinates += 1; return; }
      const prev = coordsByLabel.get(name);
      if (!prev) { coordsByLabel.set(name, c); return; }
      if (haversineKm(prev, c) > 1 && issues.coordinateConflicts.length < 20
        && !issues.coordinateConflicts.includes(name)) {
        issues.coordinateConflicts.push(name);
      }
    };
    rows.forEach((row) => {
      issues.rows += 1;
      const from = label(row[fromCol]);
      const to = label(row[toCol]);
      if (!from || !to) { issues.blankLabels += 1; return; }
      if (excludeTotals && (isTotalLabel(from) || isTotalLabel(to))) { issues.totalsExcluded += 1; return; }
      noteCoord(from, coordCols.from, row);
      noteCoord(to, coordCols.to, row);
      const group = groupCol != null ? label(row[groupCol]) : '';
      pushValue(from, to, settings.valueMode === 'count' ? 1 : row[settings.valueColumn], group);
    });
    return { edges, coordsByLabel, issues };
  }

  /**
   * Resolves labels to nodes and sums duplicates by (fromId, toId, group).
   * resolver(label) -> { status: 'ok'|'ambiguous'|'aggregate'|'none', node?, candidates?, secondary? }
   */
  function resolveAndAggregate(edges, resolver) {
    const nodes = new Map();
    const labelStatus = new Map();
    const report = {
      unresolved: new Map(),
      ambiguous: new Map(),
      aggregates: new Map(),
      secondary: new Set(),
      selfLoops: 0,
      droppedValue: 0,
      totalValue: 0,
    };
    const resolveLabel = (labelText) => {
      if (labelStatus.has(labelText)) return labelStatus.get(labelText);
      let res = isAggregateLabel(labelText) ? { status: 'aggregate' } : resolver(labelText);
      if (!res) res = { status: 'none' };
      labelStatus.set(labelText, res);
      if (res.status === 'ok' && res.node) {
        if (!nodes.has(res.node.id)) nodes.set(res.node.id, { ...res.node, labels: [labelText] });
        else if (!nodes.get(res.node.id).labels.includes(labelText)) nodes.get(res.node.id).labels.push(labelText);
        if (res.secondary) report.secondary.add(labelText);
      }
      return res;
    };
    const bump = (map, labelText, value, extra) => {
      const cur = map.get(labelText) || { label: labelText, flows: 0, value: 0, ...(extra || {}) };
      cur.flows += 1;
      cur.value += value;
      map.set(labelText, cur);
    };
    const sums = new Map();
    edges.forEach((edge) => {
      report.totalValue += edge.value;
      const a = resolveLabel(edge.from);
      const b = resolveLabel(edge.to);
      let dropped = false;
      [[edge.from, a], [edge.to, b]].forEach(([labelText, res]) => {
        if (res.status === 'ok') return;
        dropped = true;
        if (res.status === 'aggregate') bump(report.aggregates, labelText, edge.value);
        else if (res.status === 'ambiguous') bump(report.ambiguous, labelText, edge.value, { candidates: res.candidates || [] });
        else bump(report.unresolved, labelText, edge.value);
      });
      if (dropped) { report.droppedValue += edge.value; return; }
      const fromId = a.node.id;
      const toId = b.node.id;
      if (fromId === toId) { report.selfLoops += 1; return; }
      const key = `${fromId}\u0000${toId}\u0000${edge.group || ''}`;
      sums.set(key, (sums.get(key) || 0) + edge.value);
    });
    const flows = [];
    sums.forEach((value, key) => {
      const [from, to, group] = key.split('\u0000');
      flows.push({ from, to, group, value });
    });
    return { nodes, flows, report };
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
  }

  const PERIOD_RE = /^(\d{4})([年/\-.]?\d{0,2}[月/\-.]?\d{0,2}日?)?(年度|年)?$|^(fy)?\d{4}$/i;

  function listGroups(flows) {
    const seen = [];
    const set = new Set();
    flows.forEach((f) => {
      if (!set.has(f.group)) { set.add(f.group); seen.push(f.group); }
    });
    return seen;
  }

  function defaultGroup(groups) {
    if (!groups.length) return '';
    if (groups.length === 1) return groups[0];
    const looksLikePeriod = groups.every((g) => PERIOD_RE.test(nfkc(g).trim()));
    if (looksLikePeriod) return groups.slice().sort(naturalCompare).pop();
    return groups[0];
  }

  /**
   * Full build: rows + settings + resolver -> graph.
   * resolverFactory(labels, coordsByLabel) -> resolver function (lets the caller pick a gazetteer).
   */
  function buildGraph(rows, settings, resolverFactory, format) {
    const fmt = format || (settings.inputFormat !== 'auto' ? settings.inputFormat : settings.detectedFormat);
    if (fmt !== 'edge-list' && fmt !== 'od-matrix') {
      return { format: 'unknown', nodes: new Map(), flows: [], groups: [], issues: emptyIssues(), report: null, resolverInfo: null };
    }
    const { edges, coordsByLabel, issues } = toEdges(rows, settings, fmt);
    const labels = new Set();
    edges.forEach((e) => { labels.add(e.from); labels.add(e.to); });
    const factory = resolverFactory([...labels], coordsByLabel);
    const resolver = typeof factory === 'function' ? factory : factory.resolve;
    const { nodes, flows, report } = resolveAndAggregate(edges, resolver);
    const groups = listGroups(flows).sort((a, b) => naturalCompare(a, b));
    return {
      format: fmt,
      nodes,
      flows,
      groups,
      issues,
      report,
      resolverInfo: typeof factory === 'function' ? null : (factory.info || null),
      labelCount: labels.size,
    };
  }

  function pairKey(a, b) {
    return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
  }

  // Directed values for one group selection: Map "from\u0000to" -> value.
  function directedValues(flows, groupSel) {
    const map = new Map();
    flows.forEach((f) => {
      if (groupSel !== '__all__' && f.group !== groupSel) return;
      const key = `${f.from}\u0000${f.to}`;
      map.set(key, (map.get(key) || 0) + f.value);
    });
    return map;
  }

  function modeFlows(directed, flowMode) {
    const out = [];
    if (flowMode === 'net') {
      const done = new Set();
      directed.forEach((value, key) => {
        const [from, to] = key.split('\u0000');
        const pk = pairKey(from, to);
        if (done.has(pk)) return;
        done.add(pk);
        const reverse = directed.get(`${to}\u0000${from}`) || 0;
        const diff = value - reverse;
        if (diff === 0) return;
        if (diff > 0) out.push({ from, to, value: diff, forward: value, reverseValue: reverse });
        else out.push({ from: to, to: from, value: -diff, forward: reverse, reverseValue: value });
      });
      return out;
    }
    directed.forEach((value, key) => {
      const [from, to] = key.split('\u0000');
      out.push({ from, to, value, forward: value, reverseValue: directed.get(`${to}\u0000${from}`) || 0 });
    });
    return out;
  }

  /**
   * View for drawing: applies group, gross/net, focus, minValue, topN.
   * vs: {groupValue, flowMode, focusNode, focusDirection, topN, keepPairs, minValue}
   */
  function view(graph, vs = {}) {
    const groups = graph.groups || [];
    let group = vs.groupValue;
    if (group !== '__all__' && (group == null || !groups.includes(group))) group = defaultGroup(groups);
    const flowMode = vs.flowMode === 'net' ? 'net' : 'gross';

    // Width domain: max over every group, so switching periods stays comparable.
    let vmax = 0;
    const groupSelections = groups.length > 1 ? [...groups, '__all__'] : groups.length ? groups : [''];
    const domainSelections = group === '__all__' ? ['__all__'] : groupSelections.filter((g) => g !== '__all__');
    domainSelections.forEach((g) => {
      modeFlows(directedValues(graph.flows, g), flowMode).forEach((f) => { if (f.value > vmax) vmax = f.value; });
    });

    const directed = directedValues(graph.flows, group);
    const stats = new Map();
    graph.nodes.forEach((node, id) => stats.set(id, { in: 0, out: 0 }));
    directed.forEach((value, key) => {
      const [from, to] = key.split('\u0000');
      if (stats.has(from)) stats.get(from).out += value;
      if (stats.has(to)) stats.get(to).in += value;
    });
    const nodes = [];
    graph.nodes.forEach((node, id) => {
      const s = stats.get(id);
      const total = s.in + s.out;
      if (total <= 0) return;
      nodes.push({ ...node, in: s.in, out: s.out, net: s.in - s.out, total });
    });
    nodes.sort((a, b) => b.total - a.total || naturalCompare(a.label, b.label));
    const nodeIds = new Set(nodes.map((n) => n.id));

    let all = modeFlows(directed, flowMode);
    const focus = vs.focusNode && nodeIds.has(vs.focusNode) ? vs.focusNode : null;
    const direction = vs.focusDirection || 'both';
    let candidates = all;
    if (focus) {
      candidates = candidates.filter((f) => {
        if (direction === 'out') return f.from === focus;
        if (direction === 'in') return f.to === focus;
        return f.from === focus || f.to === focus;
      });
    }
    const minValue = Number(vs.minValue) || 0;
    candidates = candidates.filter((f) => f.value > 0 && f.value >= minValue);
    candidates.sort((a, b) => b.value - a.value || naturalCompare(a.from + a.to, b.from + b.to));

    const topN = Math.max(1, Math.floor(Number(vs.topN) || 100));
    let drawn;
    if (vs.keepPairs !== false && flowMode === 'gross') {
      const byPair = new Map();
      candidates.forEach((f) => {
        const pk = pairKey(f.from, f.to);
        if (!byPair.has(pk)) byPair.set(pk, { sum: 0, flows: [] });
        const entry = byPair.get(pk);
        entry.sum += f.value;
        entry.flows.push(f);
      });
      const pairs = [...byPair.values()].sort((a, b) => b.sum - a.sum);
      drawn = [];
      for (const p of pairs) {
        if (drawn.length >= topN) break;
        drawn.push(...p.flows);
      }
    } else {
      drawn = candidates.slice(0, topN);
    }
    const drawnKeys = new Set(drawn.map((f) => `${f.from}\u0000${f.to}`));
    drawn = drawn.map((f) => ({
      ...f,
      id: `${f.from}→${f.to}`,
      net: f.forward - f.reverseValue,
      partnerDrawn: drawnKeys.has(`${f.to}\u0000${f.from}`),
    }));
    drawn.sort((a, b) => b.value - a.value || naturalCompare(a.id, b.id));
    return {
      group,
      groups,
      flowMode,
      focusNode: focus,
      focusDirection: direction,
      nodes,
      flows: drawn,
      vmax,
      candidateCount: candidates.length,
      hiddenByTopN: Math.max(0, candidates.length - drawn.length),
    };
  }

  function toCsvRows(viewResult, graph) {
    const node = (id) => graph.nodes.get(id) || {};
    return viewResult.flows.map((f) => ({
      from: f.from,
      to: f.to,
      from_label: node(f.from).label || '',
      to_label: node(f.to).label || '',
      group: viewResult.group === '__all__' ? 'all' : (viewResult.group || ''),
      mode: viewResult.flowMode,
      value: f.value,
      reverse_value: f.reverseValue,
      net: f.net,
      from_lat: node(f.from).lat,
      from_lon: node(f.from).lon,
      to_lat: node(f.to).lat,
      to_lon: node(f.to).lon,
    }));
  }

  root.FlowModel = {
    ALIASES,
    TOTAL_RE,
    AGGREGATE_RE,
    parseNumber,
    normHeader,
    aliasScore,
    coordinateRole,
    isTotalLabel,
    isAggregateLabel,
    columnsOf,
    profileColumns,
    detectFormat,
    inferMapping,
    toEdges,
    resolveAndAggregate,
    listGroups,
    defaultGroup,
    buildGraph,
    view,
    toCsvRows,
    naturalCompare,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.FlowModel;
}
