(function (root) {
  'use strict';

  // Shared orchestrator for the editor and share.html:
  // rows + settings -> graph -> view -> projected scene -> FlowRenderer, plus
  // #dvz-controls, the Reset baseline, tooltips and resize handling.

  const M = () => root.FlowModel;
  const Z = () => root.FlowGazetteer;
  const GEO = () => root.FlowGeometry;
  const B = () => root.FlowBasemap;
  const H = () => root.FlowMapHelpers;

  const MODEL_KEYS = [
    'inputFormat', 'detectedFormat', 'fromColumn', 'toColumn', 'valueColumn', 'valueMode',
    'fromLatColumn', 'fromLonColumn', 'toLatColumn', 'toLonColumn', 'groupColumn',
    'matrixLabelColumn', 'matrixOrientation', 'excludeTotals', 'gazetteer', 'detectedGazetteer', 'nodeOverrides',
  ];
  const INFLOW_COLOR = '#d97706';
  const OTHER_COLOR = '#9ca3af';

  function txt(lang, ja, en) {
    return lang === 'en' ? en : ja;
  }

  function niceRound(v) {
    if (!(v > 0)) return 0;
    const p = 10 ** Math.floor(Math.log10(v));
    const m = v / p;
    const nice = m >= 5 ? 5 : m >= 2 ? 2 : 1;
    return nice * p;
  }

  function effectiveFormat(s) {
    return s.inputFormat !== 'auto' ? s.inputFormat : s.detectedFormat;
  }

  function effectiveGazetteer(s) {
    if (s.gazetteer !== 'auto') return s.gazetteer;
    return s.detectedGazetteer && s.detectedGazetteer !== 'none' ? s.detectedGazetteer : 'auto';
  }

  class FlowMapView {
    /**
     * opts: { container, controlsEl, lang, assetBase, onViewerChange(key, value), onNotice(msg, type) }
     */
    constructor(opts) {
      this.opts = opts;
      this.lang = opts.lang === 'en' ? 'en' : 'ja';
      this.container = opts.container;
      this.rows = [];
      this.rowsVersion = 0;
      this.settings = root.FlowMapSettings.defaultSettings();
      this.graph = null;
      this.view = null;
      this.indexes = null;
      this.geo = null;
      this.baseline = { focusNode: null, focusDirection: 'both' };
      this.renderer = new root.FlowRenderer(this.container, {
        lang: this.lang,
        interactive: true,
        onNodeClick: (id) => this.toggleFocus(id),
        onZoom: () => this.syncReset(),
        tooltip: (event, hit) => this.showTooltip(event, hit),
        hideTooltip: () => H().hideTooltip(),
      });
      if (opts.controlsEl) {
        this.controls = new root.FlowControls(opts.controlsEl, {
          lang: this.lang,
          handlers: {
            onChange: (key, value) => this.setViewer(key, value),
            onZoomIn: () => this.renderer.zoomBy(1.5),
            onZoomOut: () => this.renderer.zoomBy(1 / 1.5),
            onReset: () => this.resetToBaseline(),
          },
        });
      }
      this.observeResize();
    }

    async prepare() {
      if (!this.indexes) {
        this.indexes = await Z().loadAll(`${this.opts.assetBase || ''}data/gazetteer/`);
        if (!Object.keys(this.indexes).length) {
          this.opts.onNotice?.(txt(this.lang, '地名辞書を読み込めませんでした。緯度経度列だけで描画します', 'Could not load the place gazetteers; only coordinate columns are used'), 'error');
        }
      }
      return this.indexes;
    }

    geoRate(labels) {
      return Z().geoRate(labels, this.indexes || {});
    }

    // Detection for freshly loaded data. Returns mapping settings to merge.
    detect(rows) {
      const columns = M().columnsOf(rows);
      const det = M().detectFormat(rows, columns, { geoRate: (labels) => this.geoRate(labels) });
      const mapping = det.format === 'unknown' ? {} : M().inferMapping(rows, columns, det);
      return { detection: det, settings: { ...mapping, detectedFormat: det.format === 'unknown' ? 'none' : det.format, detectedGazetteer: 'none' } };
    }

    setRows(rows) {
      this.rows = Array.isArray(rows) ? rows : [];
      this.rowsVersion += 1;
      this.graph = null;
    }

    modelKey(s) {
      return JSON.stringify([this.rowsVersion, ...MODEL_KEYS.map((k) => s[k])]);
    }

    buildGraph() {
      const s = this.settings;
      const key = this.modelKey(s);
      if (this.graph && this.graphKey === key) return this.graph;
      const mode = effectiveGazetteer(s);
      this.graph = M().buildGraph(this.rows, s, (labels, coordsByLabel) => Z().createResolver({
        mode,
        indexes: this.indexes || {},
        labels,
        overrides: s.nodeOverrides || {},
        coordsByLabel,
        lang: this.lang,
      }), effectiveFormat(s));
      this.graphKey = key;
      this.projKey = null;
      return this.graph;
    }

    // Gazetteer actually used (for the detectedGazetteer snapshot).
    resolvedGazetteer() {
      return this.graph?.resolverInfo?.primary || 'none';
    }

    async update(settings, { animate = false } = {}) {
      this.settings = { ...this.settings, ...settings };
      await this.prepare();
      this.buildGraph();
      this.computeView();
      await this.ensureGeo();
      this.draw(animate);
    }

    computeView() {
      const s = this.settings;
      this.view = M().view(this.graph, {
        groupValue: s.groupValue,
        flowMode: s.flowMode,
        focusNode: s.focusNode,
        focusDirection: s.focusDirection,
        topN: s.topN,
        keepPairs: s.keepPairs,
        minValue: s.minValue,
      });
      return this.view;
    }

    graphNodes() {
      return this.graph ? [...this.graph.nodes.values()] : [];
    }

    basemapKind() {
      return B().resolveBasemapKind(this.settings.basemap, this.graphNodes());
    }

    async ensureGeo() {
      const kind = this.basemapKind();
      this.geoError = null;
      if (kind === 'none') { this.geo = null; return; }
      try {
        this.geo = await B().loadTopology(kind, `${this.opts.assetBase || ''}data/basemap/`);
      } catch (error) {
        console.error('[weighted-directed-flow-map] basemap load failed', error);
        this.geo = null;
        this.geoError = error;
      }
    }

    autoCenter() {
      const nodes = this.graph.nodes;
      const flows = this.graph.flows.map((f) => ({ lon0: nodes.get(f.from)?.lon, lon1: nodes.get(f.to)?.lon, value: f.value }));
      return GEO().autoCenterLongitude(flows, this.graphNodes().map((n) => n.lon));
    }

    centerLongitude() {
      const s = this.settings;
      if (s.centerLongitudeMode === 'manual') return s.centerLongitude;
      return this.autoCenter();
    }

    measure() {
      const rect = this.container.getBoundingClientRect();
      return {
        width: Math.max(320, Math.floor(rect.width || this.container.clientWidth || 800)),
        height: Math.max(260, Math.floor(rect.height || this.container.clientHeight || 520)),
      };
    }

    widthFor(value) {
      const s = this.settings;
      const vmax = this.view.vmax || 1;
      const ratio = Math.max(0, Math.min(1, value / vmax));
      const f = s.widthScale === 'sqrt' ? Math.sqrt(ratio) : ratio;
      return Math.max(s.minWidth, s.maxWidth * f);
    }

    nodeRank() {
      const rank = new Map();
      (this.view?.nodes || []).forEach((n, i) => rank.set(n.id, i));
      return rank;
    }

    flowColor(flow, rank) {
      const s = this.settings;
      const v = this.view;
      switch (s.colorMode) {
        case 'value': {
          const interp = H().colorInterpolator(s.colorScheme);
          return interp(0.3 + 0.7 * Math.min(1, flow.value / (v.vmax || 1)));
        }
        case 'asymmetry': {
          if (v.flowMode === 'net') return s.flowColor;
          const total = flow.forward + flow.reverseValue;
          const share = total ? (flow.forward - flow.reverseValue) / total : 0;
          return d3.interpolatePuOr(0.5 + share * 0.45);
        }
        case 'origin':
        case 'destination': {
          const id = s.colorMode === 'origin' ? flow.from : flow.to;
          const r = rank.get(id);
          return r != null && r < 10 ? d3.schemeTableau10[r] : OTHER_COLOR;
        }
        default:
          if (v.focusNode && v.focusDirection === 'both' && flow.to === v.focusNode) return INFLOW_COLOR;
          return s.flowColor;
      }
    }

    buildScene(size) {
      const s = this.settings;
      const v = this.view;
      const lang = this.lang;
      const kind = this.basemapKind();
      const nodes = this.graphNodes();
      const projKey = JSON.stringify([this.graphKey, kind, s.projection, s.centerLongitudeMode, s.centerLongitude, s.extent, s.okinawaInset, size.width, size.height, !!this.geo]);
      if (projKey !== this.projKey) {
        this.proj = B().createProjection({
          basemapKind: kind,
          projection: s.projection,
          centerLongitude: this.centerLongitude(),
          size,
          nodes,
          geo: this.geo,
          extent: s.extent,
          okinawaInset: s.okinawaInset,
        });
        this.projKey = projKey;
      }
      const proj = this.proj;

      const metric = (n) => (s.nodeSizeBy === 'in' ? n.in : s.nodeSizeBy === 'out' ? n.out : n.total);
      const maxMetric = Math.max(1, ...v.nodes.map(metric));
      const maxAbsNet = Math.max(1, ...v.nodes.map((n) => Math.abs(n.net)));
      const sceneNodes = [];
      let unprojected = 0;
      v.nodes.forEach((n) => {
        const p = proj.project(n);
        if (!p) { unprojected += 1; return; }
        const r = s.nodeSizeBy === 'none' ? 3 : 2 + (s.nodeMaxRadius - 2) * Math.sqrt(metric(n) / maxMetric);
        const fill = s.nodeColorMode === 'net' ? d3.interpolatePuOr(0.5 + (n.net / maxAbsNet) * 0.5) : '#374151';
        sceneNodes.push({ id: n.id, label: n.label, x: p[0], y: p[1], r, fill, focus: n.id === v.focusNode, data: n });
      });
      const placed = new Set(sceneNodes.map((n) => n.id));
      const rank = this.nodeRank();
      const shape = GEO().shapeParams(s.flowShape);
      const flows = [];
      let shortCount = 0;
      v.flows.forEach((f) => {
        if (!placed.has(f.from) || !placed.has(f.to)) return;
        const w = this.widthFor(f.value);
        const half = v.flowMode === 'gross' && f.partnerDrawn;
        flows.push({
          ...f,
          color: this.flowColor(f, rank),
          opacity: s.flowOpacity,
          params: {
            width: w,
            curvature: s.curvature,
            offset: half ? GEO().pairOffset(w) : 0,
            halfInner: half,
            ...shape,
          },
        });
      });
      const byId = new Map(sceneNodes.map((n) => [n.id, n]));
      flows.forEach((f) => {
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        const o = GEO().flowOutline({ ...f.params, p0: [a.x, a.y], p1: [b.x, b.y], rStart: a.r, rEnd: b.r });
        if (o.status !== 'ok') shortCount += 1;
      });

      let labels = [];
      if (s.labelMode === 'all') labels = sceneNodes.map((n) => n.id);
      else if (s.labelMode === 'top') labels = sceneNodes.slice(0, s.labelTopN).map((n) => n.id);
      if (v.focusNode && placed.has(v.focusNode)) labels = [v.focusNode, ...labels.filter((id) => id !== v.focusNode)];

      const longWay = kind === 'world' && s.centerLongitudeMode === 'manual'
        ? GEO().longWayCount(flows.map((f) => ({ lon0: byId.get(f.from).data.lon, lon1: byId.get(f.to).data.lon })), proj.center)
        : 0;
      this.stats = { shortCount, unprojected, longWay, drawn: flows.length, hiddenByTopN: v.hiddenByTopN };

      let message = '';
      if (!this.rows.length) message = '';
      else if (!this.graph || this.graph.format === 'unknown') {
        message = txt(lang, 'エッジリストまたは OD 行列として解釈できません。マッピングで列を指定してください', 'This table is not an edge list or an OD matrix yet. Choose the columns in Mapping.');
      } else if (!this.graph.nodes.size) {
        const names = this.graph.report ? [...this.graph.report.unresolved.keys()].slice(0, 5).join('、') : '';
        message = txt(lang, `地点を照合できませんでした（例：${names}）。マッピングの「地点の照合」か緯度経度列を確認してください`, `No place could be matched (e.g. ${names}). Check place matching or coordinate columns in Mapping.`);
      } else if (!flows.length) {
        message = v.focusNode
          ? txt(lang, 'この地点・方向のフローはありません', 'No flows for this place and direction')
          : txt(lang, '表示できるフローがありません（値がすべて0、または最小値・件数の条件で除外）', 'No flows to show (all zero, or filtered by minimum value / count)');
      }
      if (this.geoError) message = [message, txt(lang, 'ベースマップを読み込めませんでした', 'Could not load the basemap')].filter(Boolean).join('\n');

      const unit = s.valueUnit || '';
      const legend = this.buildLegend(flows, rank, shape, unit);
      return {
        width: size.width,
        height: size.height,
        title: s.annotateTitle || H().toolTitle(),
        desc: txt(lang, `${flows.length} 本のフロー、${sceneNodes.length} 地点`, `${flows.length} flows between ${sceneNodes.length} places`),
        basemap: this.geo ? {
          sphere: proj.sphere,
          path: proj.path,
          features: proj.insetFrame ? this.geo.mainland : (kind === 'world' ? this.geo.mainland : this.geo.features),
          borders: proj.insetFrame ? null : this.geo.borders,
          okinawa: this.geo.okinawa,
          insetPath: proj.insetPath,
          insetFrame: proj.insetFrame,
        } : null,
        nodes: sceneNodes,
        flows,
        labels,
        legend,
        message,
      };
    }

    buildLegend(flows, rank, shape, unit) {
      const s = this.settings;
      const v = this.view;
      const lang = this.lang;
      if (s.legendPosition === 'none' || !flows.length) return { position: 'none' };
      const vmax = v.vmax;
      const values = [...new Set([niceRound(vmax), niceRound(vmax / 2), niceRound(vmax / 5)].filter((x) => x > 0))];
      const unitLabel = unit ? txt(lang, `（${unit}）`, ` (${unit})`) : '';
      const title = v.flowMode === 'net' ? txt(lang, `純量${unitLabel}`, `Net flow${unitLabel}`) : txt(lang, `値${unitLabel}`, `Value${unitLabel}`);
      const spec = {
        position: s.legendPosition,
        title,
        shape: s.flowShape,
        sampleColor: s.colorMode === 'single' ? s.flowColor : '#6b7280',
        widths: values.map((x) => ({ label: H().formatCompact(x), width: this.widthFor(x) })),
      };
      if (s.colorMode === 'single' && v.focusNode && v.focusDirection === 'both') {
        spec.color = { type: 'swatches', items: [
          { color: s.flowColor, label: txt(lang, '流出', 'Outflow') },
          { color: INFLOW_COLOR, label: txt(lang, '流入', 'Inflow') },
        ] };
      } else if (s.colorMode === 'value') {
        const interp = H().colorInterpolator(s.colorScheme);
        spec.color = { type: 'gradient', title: txt(lang, '値の大小', 'Value'), stops: d3.range(6).map((i) => interp(0.3 + 0.7 * (i / 5))), left: '0', right: H().formatCompact(vmax) };
      } else if (s.colorMode === 'asymmetry' && v.flowMode === 'gross') {
        spec.color = { type: 'gradient', title: txt(lang, '往復の差', 'Two-way imbalance'), stops: d3.range(6).map((i) => d3.interpolatePuOr(0.05 + 0.9 * (i / 5))), left: txt(lang, '逆向きが多い', 'Reverse larger'), right: txt(lang, 'この向きが多い', 'This way larger') };
      } else if (s.colorMode === 'origin' || s.colorMode === 'destination') {
        const top = v.nodes.slice(0, 10);
        if (top.length <= 12) {
          spec.color = {
            type: 'swatches',
            title: s.colorMode === 'origin' ? txt(lang, '出発地', 'Origin') : txt(lang, '到着地', 'Destination'),
            items: [...top.map((n, i) => ({ color: d3.schemeTableau10[i], label: n.label })), ...(v.nodes.length > 10 ? [{ color: OTHER_COLOR, label: txt(lang, 'その他', 'Others') }] : [])],
          };
        }
      }
      if (s.nodeColorMode === 'net') {
        spec.node = { title: txt(lang, '地点の純流入', 'Net flow at places'), stops: d3.range(6).map((i) => d3.interpolatePuOr(i / 5)), left: txt(lang, '流出超過', 'Net out'), right: txt(lang, '流入超過', 'Net in') };
      }
      return spec;
    }

    draw(animate) {
      if (!this.rows.length || !this.graph) return;
      const size = this.measure();
      this.lastSize = size;
      const scene = this.buildScene(size);
      this.renderer.render(scene, { animate });
      this.syncControls();
      this.opts.onRendered?.(this.stats);
    }

    syncControls() {
      if (!this.controls || !this.view) return;
      const s = this.settings;
      this.controls.update({
        nodes: this.view.nodes.map((n) => ({ id: n.id, label: n.label })),
        groups: this.view.groups,
        groupLabel: s.groupColumn || '',
        focusNode: this.view.focusNode,
        focusDirection: s.focusDirection,
        flowMode: s.flowMode,
        group: this.view.group,
      });
      this.syncReset();
    }

    isDirty() {
      const s = this.settings;
      return this.renderer.isZoomed()
        || (s.focusNode || null) !== (this.baseline.focusNode || null)
        || (s.focusDirection || 'both') !== (this.baseline.focusDirection || 'both');
    }

    syncReset() {
      this.controls?.setResetVisible(this.isDirty());
    }

    captureBaseline() {
      this.baseline = { focusNode: this.settings.focusNode || null, focusDirection: this.settings.focusDirection || 'both' };
      this.syncReset();
    }

    resetToBaseline() {
      this.renderer.resetZoom();
      const { focusNode, focusDirection } = this.baseline;
      if ((this.settings.focusNode || null) !== focusNode) this.setViewer('focusNode', focusNode, { silentReset: true });
      if ((this.settings.focusDirection || 'both') !== focusDirection) this.setViewer('focusDirection', focusDirection, { silentReset: true });
      this.syncReset();
    }

    setViewer(key, value) {
      this.settings = { ...this.settings, [key]: value };
      if (key === 'focusNode' && !value) this.settings.focusDirection = this.settings.focusDirection || 'both';
      this.opts.onViewerChange?.(key, value);
      this.computeView();
      this.draw(true);
    }

    toggleFocus(id) {
      this.setViewer('focusNode', this.settings.focusNode === id ? null : id);
    }

    nodeLabel(id) {
      return this.graph?.nodes.get(id)?.label || id;
    }

    showTooltip(event, hit) {
      const lang = this.lang;
      const unit = this.settings.valueUnit || '';
      const fmt = (x) => H().withUnit(H().formatNumber(x), unit);
      if (hit.type === 'node') {
        const n = this.view.nodes.find((x) => x.id === hit.id);
        if (!n) return;
        const net = n.net > 0 ? `+${H().formatNumber(n.net)}` : H().formatNumber(n.net);
        H().showTooltip(event, [
          { text: n.label, strong: true },
          { text: `${txt(lang, '流出', 'Outflow')}: ${fmt(n.out)}` },
          { text: `${txt(lang, '流入', 'Inflow')}: ${fmt(n.in)}` },
          { text: `${txt(lang, '純流入', 'Net inflow')}: ${H().withUnit(net, unit)}` },
          { text: txt(lang, 'クリックでこの地点に絞り込み', 'Click to focus on this place'), muted: true },
        ]);
        return;
      }
      const f = this.view.flows.find((x) => x.id === hit.id);
      if (!f) return;
      const a = this.nodeLabel(f.from);
      const b = this.nodeLabel(f.to);
      const lines = [{ text: `${a} → ${b}`, strong: true }];
      if (this.view.flowMode === 'net') {
        lines.push({ text: `${txt(lang, '純量', 'Net')}: ${fmt(f.value)}` });
        lines.push({ text: `${a} → ${b}: ${fmt(f.forward)}`, muted: true });
        lines.push({ text: `${b} → ${a}: ${fmt(f.reverseValue)}`, muted: true });
      } else {
        lines.push({ text: `${txt(lang, '値', 'Value')}: ${fmt(f.value)}` });
        lines.push({ text: `${txt(lang, '逆方向', 'Reverse')}（${b} → ${a}）: ${fmt(f.reverseValue)}` });
        const diff = f.value - f.reverseValue;
        lines.push({ text: `${txt(lang, '差', 'Difference')}: ${H().withUnit(diff > 0 ? `+${H().formatNumber(diff)}` : H().formatNumber(diff), unit)}` });
      }
      H().showTooltip(event, lines);
    }

    observeResize() {
      if (typeof ResizeObserver !== 'function') return;
      let frame = 0;
      this.resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (!this.view) return;
          const size = this.measure();
          if (this.lastSize && size.width === this.lastSize.width && size.height === this.lastSize.height) return;
          this.draw(false);
        });
      });
      this.resizeObserver.observe(this.container);
    }

    csvRows() {
      if (!this.view || !this.graph) return [];
      return M().toCsvRows(this.view, this.graph);
    }

    report() {
      return this.graph ? { report: this.graph.report, issues: this.graph.issues, info: this.graph.resolverInfo, format: this.graph.format } : null;
    }

    clear() {
      this.rows = [];
      this.graph = null;
      this.view = null;
      this.renderer.destroy();
      this.controls?.clear();
    }
  }

  FlowMapView.MODEL_KEYS = MODEL_KEYS;
  FlowMapView.effectiveFormat = effectiveFormat;
  root.FlowMapView = FlowMapView;
})(typeof window !== 'undefined' ? window : globalThis);
