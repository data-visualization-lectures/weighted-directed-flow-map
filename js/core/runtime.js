(function (root) {
  'use strict';

  const H = () => root.FlowMapHelpers;
  const SPEC = () => root.FlowMapSettings.SETTINGS_SPEC;
  const Settings = () => root.FlowMapSettings;
  const Catalog = () => root.FlowSampleCatalog;

  const ANNOTATE_KEYS = ['annotateTitle', 'annotateSource', 'annotateSourceUrl', 'valueUnit', 'legendPosition'];
  const STYLE_ANIMATED = new Set(['pairLayout', 'flowShape', 'curvature', 'maxWidth', 'minWidth', 'widthScale', 'topN', 'keepPairs', 'minValue', 'nodeSizeBy', 'nodeMaxRadius']);

  function rowsToPayload(rows) {
    const columns = Array.isArray(rows?.columns) ? rows.columns.slice() : (rows?.[0] ? Object.keys(rows[0]) : []);
    return { columns, rows: (rows || []).map((row) => columns.map((c) => (row[c] == null ? '' : String(row[c])))) };
  }

  function payloadToRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) {
      const rows = data.slice();
      rows.columns = data[0] ? Object.keys(data[0]) : [];
      return rows;
    }
    const columns = Array.isArray(data.columns) ? data.columns : [];
    const rows = (Array.isArray(data.rows) ? data.rows : []).map((values) => {
      const obj = {};
      columns.forEach((c, i) => { obj[c] = Array.isArray(values) ? (values[i] ?? '') : (values?.[c] ?? ''); });
      return obj;
    });
    rows.columns = columns;
    return rows;
  }

  class FlowMapApp {
    constructor() {
      this.config = H().TOOL_CONFIG;
      this.lang = H().resolveLocale();
      this.settings = Settings().defaultSettings();
      this.rows = [];
      this.dataName = '';
      this.dataSource = null;
      this.currentProjectId = null;
      this.currentProjectName = null;
      this.hasLoadedProject = false;
      this.projectLoadStarted = false;
      this.lastSavedSerialized = null;
    }

    init() {
      Catalog()?.installPickerPatch?.();
      H().dvzInitGA(this.config.gaId);
      this.mountShell();
      this.mountSidebar();
      H().dvzApplyI18n();
      document.title = `${H().toolTitle()} | dataviz.jp`;
      this.adapter = {
        getSettings: () => this.getSettings(),
        applySettings: (settings) => this.applySettings(settings),
        render: () => this.render(),
      };
      this.view = new root.FlowMapView({
        container: document.getElementById('chart-container'),
        controlsEl: document.getElementById('dvz-controls'),
        lang: this.lang,
        onViewerChange: (key, value) => {
          this.settings[key] = value;
        },
        onNotice: (msg, type) => H().dvzShowToast(msg, type),
        onRendered: (stats) => this.syncStatsNotes(stats),
      });
      this.bindStaticUi();
      this.syncAllPanels();
      this.setupHeader();
      this.startLoad();
    }

    mountShell() {
      root.DVZEditorShell?.mount?.({ appSelector: '.dvz-app', headerSelector: 'dataviz-tool-header' });
    }

    mountSidebar() {
      const spec = Settings().SIDEBAR_SPEC;
      root.DVZSettingSidebar?.mount?.({
        root: '#dvz-sidebar',
        defaultTabId: spec.tabs[0].id,
        labels: { select: H().tKey('tabSelect') },
      });
    }

    get header() {
      return document.querySelector('dataviz-tool-header');
    }

    // ---------- load priority: projectId -> data_url -> catalog -> local ----------

    startLoad() {
      const params = new URLSearchParams(location.search);
      if (params.get('projectId')) {
        this.projectLoadStarted = true;
        return; // setupHeader() calls header.loadProject once the header is ready.
      }
      this.view.prepare().then(async () => {
        if (this.shouldSkipAutoSampleLoad()) return;
        if (params.get('data_url')) {
          await this.loadFromUrl(params.get('data_url'), null, { source: 'data_url', background: true });
          return;
        }
        const fromCatalog = await this.autoLoadFromCatalog();
        if (!fromCatalog && !this.shouldSkipAutoSampleLoad() && !this.rows.length) await this.loadLocalDefault();
      });
    }

    shouldSkipAutoSampleLoad() {
      return this.hasLoadedProject || this.projectLoadStarted || !!new URLSearchParams(location.search).get('projectId');
    }

    pickSampleUrl(entry) {
      return this.lang === 'en' ? (entry.fileUrlEn || entry.fileUrl) : (entry.fileUrl || entry.fileUrlEn);
    }

    annotationFromEntry(entry) {
      const en = this.lang === 'en';
      const local = Catalog().findLocal(entry?.id) || Catalog().findLocal(entry?.fileUrl);
      const unitExtra = entry?.extra?.valueUnit;
      const unit = unitExtra ? (typeof unitExtra === 'string' ? unitExtra : unitExtra[en ? 'en' : 'ja']) : (local ? Catalog().annotationFor(local, this.lang).unit : '');
      return {
        title: '',
        source: en ? (entry?.sourceEn || entry?.source || '') : (entry?.source || entry?.sourceEn || ''),
        sourceUrl: entry?.sourceUrl || '',
        unit: unit || '',
      };
    }

    async autoLoadFromCatalog() {
      if (this.shouldSkipAutoSampleLoad()) return false;
      try {
        const catalogUrl = `${root.datavizAuthUrl || 'https://app.dataviz.jp'}/catalog.json`;
        const res = await fetch(catalogUrl, { signal: AbortSignal.timeout(4000) });
        if (this.shouldSkipAutoSampleLoad() || !res.ok) return false;
        const catalog = await res.json();
        const entries = (catalog.entries || []).filter((entry) => (entry.compatibleTools || [])
          .some((token) => token === this.config.appName || String(token).startsWith(`${this.config.appName}/`)));
        if (!entries.length) return false;
        const preferred = entries.find((e) => e.id === Catalog().defaultEntry().id) || entries[0];
        const url = this.pickSampleUrl(preferred);
        if (!url) return false;
        const name = this.lang === 'en' ? (preferred.nameEn || preferred.name) : preferred.name;
        return this.loadFromUrl(url, name, { source: 'sample', background: true, annotation: this.annotationFromEntry(preferred) });
      } catch (_error) {
        return false;
      }
    }

    async loadLocalDefault() {
      const entry = Catalog().defaultEntry();
      const local = Catalog().getLocalEntries().find((e) => e.id === entry.id);
      const name = this.lang === 'en' ? entry.nameEn : entry.name;
      return this.loadFromUrl(this.pickSampleUrl(local), name, {
        source: 'sample',
        background: true,
        annotation: Catalog().annotationFor(entry, this.lang),
      });
    }

    async loadFromUrl(url, name, options = {}) {
      if (options.background && this.shouldSkipAutoSampleLoad()) return false;
      if (!options.background) H().dvzShowProcessingToast(H().t('サンプルを読み込んでいます', 'Loading sample'));
      try {
        const res = await fetch(url);
        if (options.background && this.shouldSkipAutoSampleLoad()) return false;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (options.background && this.shouldSkipAutoSampleLoad()) return false;
        const filename = decodeURIComponent(String(url).split('?')[0].split('/').pop() || 'data.csv');
        const rows = H().parseTableText(text, filename);
        await this.applyRows(rows, name || filename, { source: options.source || 'sample', annotation: options.annotation });
        return true;
      } catch (error) {
        console.error('[weighted-directed-flow-map] data load failed', error);
        if (options.source === 'data_url' || !options.background) {
          H().dvzShowToast(H().t('データを読み込めませんでした', 'Failed to load data'), 'error');
        }
        return false;
      }
    }

    // New data from a sample, upload or URL: detect, map, and draw.
    async applyRows(rows, name, meta = {}) {
      await this.view.prepare();
      this.rows = Array.isArray(rows) ? rows : [];
      if (!Array.isArray(this.rows.columns)) this.rows.columns = this.rows[0] ? Object.keys(this.rows[0]) : [];
      this.dataName = name || '';
      this.dataSource = meta.source || 'upload';
      const { settings: detected } = this.view.detect(this.rows);
      const base = Settings().defaultSettings();
      const keep = {};
      Object.keys(base).forEach((key) => {
        if (Settings().MAPPING_KEYS.includes(key) || Settings().CONTROL_KEYS.includes(key) || Settings().INTERNAL_KEYS.includes(key)) return;
        if (ANNOTATE_KEYS.includes(key)) return;
        keep[key] = this.settings[key];
      });
      this.settings = { ...base, ...keep, ...detected, legendPosition: this.settings.legendPosition };
      const annotation = meta.annotation || { title: '', source: '', sourceUrl: '', unit: '' };
      this.settings.annotateTitle = annotation.title || '';
      this.settings.annotateSource = annotation.source || '';
      this.settings.annotateSourceUrl = annotation.sourceUrl || '';
      this.settings.valueUnit = annotation.unit || '';
      if (this.dataSource !== 'project') {
        this.currentProjectId = null;
        this.currentProjectName = null;
        const sourceType = { sample: 'sample', upload: 'import', data_url: 'external-url' }[this.dataSource] || 'import';
        this.header?.setProjectContext?.({ sourceType, canOverwrite: false, sourceName: this.dataName });
      }
      this.view.setRows(this.rows);
      await this.view.update(this.settings, { animate: false });
      if (this.settings.gazetteer === 'auto') this.settings.detectedGazetteer = this.view.resolvedGazetteer();
      this.view.settings.detectedGazetteer = this.settings.detectedGazetteer;
      this.view.captureBaseline();
      this.syncAllPanels();
      this.renderAnnotations();
      this.noticeUnresolved();
      if (rows.duplicateColumns?.length) {
        H().dvzShowToast(H().t(`列名が重複しています：${rows.duplicateColumns.join('、')}`, `Duplicate column names: ${rows.duplicateColumns.join(', ')}`), 'error');
      }
    }

    noticeUnresolved() {
      const report = this.view.report()?.report;
      if (!report) return;
      const n = report.unresolved.size + report.ambiguous.size;
      if (!n) return;
      const share = report.totalValue ? Math.round((report.droppedValue / report.totalValue) * 1000) / 10 : 0;
      H().dvzShowToast(H().t(
        `${n} 地点を照合できず、合計の ${share}% を除外しました。マッピングの「地点の照合結果」を確認してください`,
        `${n} places could not be matched (${share}% of the total was left out). See the matching result in Mapping.`,
      ), 'error');
    }

    // ---------- header / project / share ----------

    setupHeader() {
      const header = this.header;
      if (!header) return;
      const waitReady = () => new Promise((resolve) => {
        if (typeof header.setProjectConfig === 'function') { resolve(); return; }
        const timer = setInterval(() => {
          if (typeof header.setProjectConfig === 'function') { clearInterval(timer); resolve(); }
        }, 50);
        setTimeout(() => { clearInterval(timer); resolve(); }, 4000);
      });
      waitReady().then(() => {
        this.applyHeaderButtons();
        header.setProjectConfig?.({
          appName: this.config.appName,
          toolName: this.config.title,
          toolNameEn: this.config.titleEn,
          onProjectLoad: (data, meta) => this.onProjectLoad(data, meta),
          onProjectSave: (meta) => {
            this.currentProjectId = meta?.id || meta?.project?.id || this.currentProjectId;
            this.currentProjectName = meta?.name || meta?.project?.name || this.currentProjectName;
            this.lastSavedSerialized = JSON.stringify(this.getWrappedProjectData());
            this.view.captureBaseline();
          },
          onProjectDelete: () => {
            this.currentProjectId = null;
            this.currentProjectName = null;
          },
        });
        header.setShareConfig?.({
          getSavePayload: () => this.buildSavePayload(),
          getShareTitle: () => this.settings.annotateTitle || this.currentProjectName || H().toolTitle(),
          publishShare: ({ projectId, title }) => this.publishShare({ projectId, title }),
        });
        header.setSampleConfig?.({
          toolId: this.config.appName,
          onSampleSelect: async (detail) => {
            if (!detail?.url) return;
            const name = this.lang === 'en' ? (detail.nameEn || detail.name) : (detail.name || detail.nameEn);
            await this.loadFromUrl(detail.url, name, { source: 'sample', annotation: this.annotationFromEntry({ ...detail, id: detail.catalogId }) });
          },
        });
        const projectId = new URLSearchParams(location.search).get('projectId');
        if (projectId) this.restoreProjectFromRoute(header, projectId);
      });
      window.addEventListener('resize', () => this.applyHeaderButtons());
    }

    // ?projectId= launch (e.g. from the app.dataviz.jp project list).
    // header.loadProject() returns the saved data and does NOT call onProjectLoad,
    // so the restore is done here with the returned data.
    async restoreProjectFromRoute(header, projectId) {
      if (this.routeProjectLoadStarted) return;
      this.routeProjectLoadStarted = true;
      if (typeof header?.loadProject !== 'function') {
        H().dvzShowToast(H().t('プロジェクトを読み込めませんでした', 'Could not load the project'), 'error');
        return;
      }
      try {
        const data = await header.loadProject(projectId);
        if (!data) {
          H().dvzShowToast(H().t('プロジェクトが見つかりません', 'Project not found'), 'error');
          return;
        }
        const context = typeof header.getProjectContext === 'function' ? header.getProjectContext() : {};
        await this.onProjectLoad(data, {
          id: projectId,
          name: context.projectName || null,
          isGroupProject: context.sourceType === 'group-project',
        });
      } catch (error) {
        console.error('[weighted-directed-flow-map] project route restore failed', error);
      }
    }

    applyHeaderButtons() {
      const header = this.header;
      if (!header?.setConfig) return;
      const compact = window.matchMedia('(max-width: 640px)').matches;
      const en = this.lang === 'en';
      header.setConfig({
        logo: { type: 'text', text: H().toolTitle() },
        buttons: [
          { label: compact ? (en ? 'Load' : '読込') : (en ? 'Load' : 'プロジェクトの読込'), action: () => header.showLoadModal(), align: 'right' },
          {
            label: compact ? (en ? 'Save' : '保存') : (en ? 'Save' : 'プロジェクトの保存'),
            action: async () => {
              H().dvzShowProcessingToast(H().t('保存準備中です', 'Preparing save...'));
              const payload = await this.buildSavePayload();
              if (!payload?.data) {
                header.showMessage?.(H().t('保存するデータがありません', 'No data to save'), 'error');
                return;
              }
              header.showSaveModal(payload);
            },
            align: 'right',
          },
          { label: en ? 'Share' : 'シェア', action: () => header.shareProject?.(), align: 'right' },
        ],
      });
    }

    getChartData() {
      if (!this.rows.length) return null;
      const spec = SPEC();
      const data = rowsToPayload(this.rows);
      const settings = { ...this.settings };
      const payload = root.DVZSettingsCompat?.build
        ? root.DVZSettingsCompat.build(spec, { data, settings })
        : { version: spec.version, chartType: spec.chartType, data, settings };
      payload.chartType = spec.chartType;
      payload.dataName = this.dataName;
      ['annotateTitle', 'annotateSource', 'annotateSourceUrl', 'legendPosition'].forEach((key) => {
        payload[key] = this.settings[key];
        payload.settings[key] = this.settings[key];
      });
      return payload;
    }

    getWrappedProjectData() {
      const chartData = this.getChartData();
      if (!chartData) return null;
      return { version: 1, chartType: SPEC().chartType, chartData };
    }

    async buildSavePayload() {
      const data = this.getWrappedProjectData();
      if (!data) return null;
      let thumbnailDataUri = null;
      try {
        thumbnailDataUri = await H().generateThumbnail();
      } catch (_error) {
        thumbnailDataUri = null;
      }
      return {
        name: this.currentProjectName || this.settings.annotateTitle || this.dataName || H().toolTitle(),
        data,
        thumbnailDataUri,
        existingProjectId: this.currentProjectId,
      };
    }

    async onProjectLoad(projectData, meta) {
      this.hasLoadedProject = true;
      this.projectLoadStarted = true;
      if (meta?.isGroupProject) {
        this.currentProjectId = null;
        this.currentProjectName = null;
      } else {
        this.currentProjectId = meta?.id || meta?.project?.id || this.currentProjectId;
        this.currentProjectName = meta?.name || meta?.project?.name || this.currentProjectName;
      }
      const wrapped = projectData?.chartData ? projectData : { chartData: projectData };
      await this.loadChartData(wrapped.chartData);
      this.lastSavedSerialized = JSON.stringify(this.getWrappedProjectData());
    }

    // Shared restore path for projects (and the same normalisation as share.html).
    async loadChartData(payload) {
      const normalized = normalizePayload(payload);
      this.settings = normalized.settings;
      this.rows = payloadToRows(normalized.data);
      this.dataName = payload?.dataName || this.currentProjectName || '';
      this.dataSource = 'project';
      await this.view.prepare();
      this.view.setRows(this.rows);
      await this.view.update(this.settings, { animate: false });
      this.view.captureBaseline();
      this.syncAllPanels();
      this.renderAnnotations();
    }

    async publishShare({ projectId, title } = {}) {
      const savedProjectId = String(projectId || this.currentProjectId || '').trim();
      if (!savedProjectId) {
        throw new Error(H().t('シェアする前にプロジェクトを保存してください', 'Save the project before sharing.'));
      }
      H().dvzShowProcessingToast(H().t('シェアを作成中です', 'Creating share...'));
      const shareTitle = title || this.settings.annotateTitle || this.currentProjectName || H().toolTitle();
      const result = await H().dvzPublishShareFromProject({ projectId: savedProjectId, fallbackTitle: shareTitle });
      const shareId = result.shareId || result.id;
      if (!shareId) throw new Error('No share ID returned');
      return {
        shareId,
        shareUrl: H().buildPublicSharePageUrl(shareId),
        iframeCode: H().buildIframeEmbedCode(shareId, shareTitle),
      };
    }

    // ---------- adapter ----------

    getSettings() {
      return { ...this.settings };
    }

    async applySettings(next) {
      this.settings = Settings().sanitizeSettings({ ...Settings().defaultSettings(), ...(next || {}) }, this.rows.columns);
      this.syncAllPanels();
      await this.view.update(this.settings, { animate: true });
      this.renderAnnotations();
    }

    render() {
      return this.view.update(this.settings, { animate: false });
    }

    // ---------- sidebar ----------

    bindStaticUi() {
      H().dvzInitFileUpload((parsed) => {
        this.applyRows(parsed.data, parsed.filename, { source: 'upload', annotation: { title: '', source: '', sourceUrl: '', unit: '' } });
      });
      document.querySelectorAll('#dvz-sidebar [data-setting]').forEach((input) => {
        const handler = () => this.onSettingInput(input);
        input.addEventListener(input.type === 'range' ? 'input' : 'change', handler);
      });
      document.querySelectorAll('#tab-annotate [data-annotate]').forEach((input) => {
        const isText = input.tagName !== 'SELECT';
        input.addEventListener(isText ? 'input' : 'change', () => {
          const key = input.getAttribute('data-annotate');
          this.settings = { ...this.settings, [key]: input.value || (isText ? '' : 'none') };
          this.renderAnnotations();
          if (!isText && this.rows.length) this.view.update(this.settings, { animate: false });
        });
      });
      document.getElementById('export-svg-btn')?.addEventListener('click', () => this.exportImage('svg'));
      document.getElementById('export-png-btn')?.addEventListener('click', () => this.exportImage('png'));
      document.getElementById('export-csv-btn')?.addEventListener('click', () => this.exportCsv());
      document.getElementById('export-json-btn')?.addEventListener('click', () => this.exportJson());
      document.getElementById('match-report')?.addEventListener('change', (event) => {
        const select = event.target.closest('select[data-override-label]');
        if (!select) return;
        const overrides = { ...(this.settings.nodeOverrides || {}) };
        const key = root.FlowGazetteer.normalizeName(select.getAttribute('data-override-label'));
        if (select.value) overrides[key] = select.value;
        else delete overrides[key];
        this.updateSettings({ nodeOverrides: overrides }, { model: true });
      });
    }

    readInputValue(input, key) {
      const spec = SPEC().fields[key];
      if (input.type === 'checkbox') return input.checked;
      if (spec.type === 'number') {
        const n = Number(input.value);
        return Number.isFinite(n) ? n : spec.default;
      }
      if (input.hasAttribute('data-columns')) {
        if (input.value === '__none__') return null;
        if (input.value === '__count__') return null;
        return input.value;
      }
      return input.value;
    }

    onSettingInput(input) {
      const key = input.getAttribute('data-setting');
      if (!key) return;
      const patch = { [key]: this.readInputValue(input, key) };
      const mapping = Settings().MAPPING_KEYS.includes(key);
      if (key === 'valueColumn') patch.valueMode = input.value === '__count__' ? 'count' : 'column';
      if (key === 'centerLongitude') patch.centerLongitudeMode = 'manual';
      if (mapping) {
        // Re-run gazetteer detection for the new mapping; keep the explicit choice otherwise.
        patch.detectedGazetteer = 'none';
        if (key === 'inputFormat' && patch.inputFormat !== 'auto') {
          const inferred = root.FlowModel.inferMapping(this.rows, this.rows.columns, { format: patch.inputFormat, labelColumn: this.settings.matrixLabelColumn });
          Object.entries(inferred).forEach(([k, v]) => {
            if (this.settings[k] == null && v != null) patch[k] = v;
          });
        }
        patch.focusNode = null;
        patch.groupValue = null;
      }
      this.updateSettings(patch, { model: mapping, animate: STYLE_ANIMATED.has(key) });
    }

    async updateSettings(patch, { model = false, animate = false } = {}) {
      this.settings = Settings().sanitizeSettings({ ...this.settings, ...patch }, this.rows.columns);
      if (!this.rows.length) { this.syncAllPanels(); return; }
      await this.view.update(this.settings, { animate });
      if (model) {
        if (this.settings.gazetteer === 'auto' && this.settings.detectedGazetteer === 'none') {
          this.settings.detectedGazetteer = this.view.resolvedGazetteer();
          this.view.settings.detectedGazetteer = this.settings.detectedGazetteer;
        }
        this.view.captureBaseline();
      }
      this.syncAllPanels();
    }

    readAnnotations() {
      const patch = {};
      document.querySelectorAll('#tab-annotate [data-annotate]').forEach((input) => {
        patch[input.getAttribute('data-annotate')] = input.value || (input.tagName === 'SELECT' ? 'none' : '');
      });
      this.settings = { ...this.settings, ...patch };
      this.renderAnnotations();
      if (this.rows.length) this.view.update(this.settings, { animate: false });
    }

    renderAnnotations() {
      const titleEl = document.getElementById('chart-title');
      if (titleEl) titleEl.textContent = this.settings.annotateTitle || '';
      renderSource(document.getElementById('chart-source'), this.settings.annotateSource, this.settings.annotateSourceUrl);
    }

    // ---------- panel sync ----------

    syncAllPanels() {
      this.syncDataPanel();
      this.syncMappingPanel();
      this.syncStylePanel();
      this.syncAnnotatePanel();
      this.syncMatchReport();
    }

    columnLabel(col) {
      return col === '' ? H().tKey('firstColumn') : col;
    }

    syncDataPanel() {
      const summary = document.getElementById('data-summary');
      const preview = document.getElementById('data-preview');
      const columns = this.rows.columns || [];
      if (summary) {
        summary.replaceChildren();
        if (!this.rows.length) {
          summary.appendChild(textEl('p', 'data-meta-summary', H().tKey('noData')));
        } else {
          const line = textEl('div', 'data-source-line');
          const badgeKey = { sample: 'badgeSample', upload: 'badgeUpload', project: 'badgeProject', data_url: 'badgeUrl' }[this.dataSource] || 'badgeUpload';
          const badge = textEl('span', 'data-source-badge', H().tKey(badgeKey));
          badge.setAttribute('data-source-type', this.dataSource === 'sample' ? 'sample' : (this.dataSource === 'project' ? 'project' : 'upload'));
          line.appendChild(badge);
          const name = textEl('span', 'data-source-name', this.dataName || 'data');
          name.title = this.dataName || '';
          line.appendChild(name);
          summary.appendChild(line);
          summary.appendChild(textEl('p', 'data-meta-summary', `${this.rows.length} ${H().tKey('rows')} × ${columns.length} ${H().tKey('cols')}`));
          const cols = textEl('p', 'data-meta-columns', columns.map((c) => this.columnLabel(c)).join(', '));
          cols.title = cols.textContent;
          summary.appendChild(cols);
        }
      }
      if (preview) {
        preview.replaceChildren();
        if (!this.rows.length) {
          preview.appendChild(textEl('p', 'data-preview-empty', H().tKey('noPreview')));
        } else {
          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const hr = document.createElement('tr');
          columns.forEach((c) => hr.appendChild(textEl('th', null, this.columnLabel(c))));
          thead.appendChild(hr);
          const tbody = document.createElement('tbody');
          this.rows.slice(0, 5).forEach((row) => {
            const tr = document.createElement('tr');
            columns.forEach((c) => tr.appendChild(textEl('td', null, row[c] == null ? '' : String(row[c]))));
            tbody.appendChild(tr);
          });
          table.append(thead, tbody);
          preview.appendChild(table);
        }
      }
    }

    syncMappingPanel() {
      const s = this.settings;
      const columns = this.rows.columns || [];
      document.querySelectorAll('#tab-mapping select[data-columns]').forEach((select) => {
        const key = select.getAttribute('data-setting');
        const options = [];
        if (select.hasAttribute('data-allow-none')) options.push(['__none__', H().tKey('optNone')]);
        if (select.hasAttribute('data-allow-count')) options.push(['__count__', H().tKey('optCount')]);
        columns.forEach((c) => options.push([c, this.columnLabel(c)]));
        select.replaceChildren(...options.map(([v, label]) => {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = label;
          return o;
        }));
        let value = s[key];
        if (key === 'valueColumn' && s.valueMode === 'count') value = '__count__';
        select.value = value == null ? (select.hasAttribute('data-allow-none') ? '__none__' : '') : value;
      });
      this.syncSimpleInputs('#tab-mapping');
      const format = root.FlowMapView.effectiveFormat(s);
      document.querySelectorAll('#tab-mapping [data-format]').forEach((section) => {
        section.hidden = section.getAttribute('data-format') !== format;
      });
      const note = document.getElementById('map-format-note');
      if (note) {
        note.textContent = !this.rows.length ? '' : format === 'od-matrix'
          ? H().t('OD 行列として読んでいます', 'Read as an OD matrix')
          : format === 'edge-list'
            ? H().t('エッジリストとして読んでいます', 'Read as an edge list')
            : H().t('形式を判定できません。形式と列を指定してください', 'Could not detect the format. Choose it and the columns.');
      }
    }

    syncSimpleInputs(scope) {
      const s = this.settings;
      document.querySelectorAll(`${scope} [data-setting]:not([data-columns])`).forEach((input) => {
        const key = input.getAttribute('data-setting');
        const value = s[key];
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = value == null ? '' : String(value);
        const out = document.querySelector(`output[data-for="${input.id}"]`);
        if (out) out.textContent = input.value;
      });
    }

    syncStylePanel() {
      const s = this.settings;
      this.syncSimpleInputs('#tab-style');
      const kind = this.view?.graph ? this.view.basemapKind() : (s.basemap === 'auto' ? 'world' : s.basemap);
      document.querySelectorAll('#tab-style [data-basemap-only]').forEach((el) => {
        el.hidden = el.getAttribute('data-basemap-only') !== kind;
      });
      document.querySelectorAll('#tab-style [data-color-mode]').forEach((el) => {
        el.hidden = el.getAttribute('data-color-mode') !== s.colorMode;
      });
      document.querySelectorAll('#tab-style [data-pair-layout]').forEach((el) => {
        el.hidden = el.getAttribute('data-pair-layout') !== s.pairLayout;
      });
      const center = document.getElementById('style-center');
      if (center) {
        if (s.centerLongitudeMode === 'auto' && this.view?.graph) center.value = String(this.view.centerLongitude());
        center.disabled = false;
      }
    }

    syncStatsNotes(stats) {
      const hidden = document.getElementById('style-hidden-note');
      if (hidden) {
        const parts = [];
        if (stats.hiddenByTopN) parts.push(H().t(`件数の上限で ${stats.hiddenByTopN} 本を省略`, `${stats.hiddenByTopN} flows hidden by the count limit`));
        if (stats.shortCount) parts.push(H().t(`${stats.shortCount} 本は短すぎて非表示（拡大で表示）`, `${stats.shortCount} flows are too short to draw (zoom in to see them)`));
        hidden.textContent = parts.join(' / ');
      }
      const longway = document.getElementById('style-longway-note');
      if (longway) {
        longway.textContent = stats.longWay
          ? H().t(`${stats.longWay} 本のフローが遠回りしています。中心経度を見直してください`, `${stats.longWay} flows take the long way round. Adjust the center longitude.`)
          : '';
      }
      this.syncStylePanel();
    }

    syncAnnotatePanel() {
      document.querySelectorAll('#tab-annotate [data-annotate]').forEach((input) => {
        const key = input.getAttribute('data-annotate');
        input.value = this.settings[key] == null ? '' : String(this.settings[key]);
      });
    }

    syncMatchReport() {
      const box = document.getElementById('match-report');
      if (!box) return;
      box.replaceChildren();
      const info = this.view?.report();
      if (!info || !info.report) {
        box.appendChild(textEl('p', 'panel-note', this.rows.length ? H().t('形式と列を指定すると照合します', 'Choose the format and columns to match places') : ''));
        return;
      }
      const { report, issues } = info;
      const graph = this.view.graph;
      const total = graph.labelCount || 0;
      const kindLabel = {
        'jp-prefectures': H().tKey('gazJp'),
        'world-countries': H().tKey('gazCountries'),
        'world-cities': H().tKey('gazCities'),
        coordinates: H().tKey('gazCoords'),
      }[info.info?.primary] || '';
      const matchedLabels = total - report.unresolved.size - report.ambiguous.size - report.aggregates.size;
      box.appendChild(textEl('p', 'match-summary', H().t(
        `${matchedLabels} / ${total} 件の地名を照合しました${kindLabel ? `（${kindLabel}）` : ''}`,
        `Matched ${matchedLabels} of ${total} place names${kindLabel ? ` (${kindLabel})` : ''}`,
      )));
      const fmt = (x) => H().formatNumber(x);
      const list = (title, map, render) => {
        if (!map.size) return;
        box.appendChild(textEl('p', 'match-group-title', title));
        const ul = document.createElement('ul');
        ul.className = 'match-list';
        [...map.values()].sort((a, b) => b.value - a.value).slice(0, 50).forEach((item) => ul.appendChild(render(item)));
        box.appendChild(ul);
      };
      const simpleItem = (item) => textEl('li', null, H().t(
        `${item.label}（${item.flows} 本、${fmt(item.value)}）`,
        `${item.label} (${item.flows} flows, ${fmt(item.value)})`,
      ));
      list(H().t('照合できない地名', 'Unmatched names'), report.unresolved, simpleItem);
      list(H().t('候補が複数ある地名（選んでください）', 'Ambiguous names (choose one)'), report.ambiguous, (item) => {
        const li = document.createElement('li');
        li.appendChild(textEl('span', null, `${item.label} `));
        const select = document.createElement('select');
        select.setAttribute('data-override-label', item.label);
        select.appendChild(new Option(H().t('選択…', 'Choose…'), ''));
        item.candidates.forEach((id) => {
          const node = root.FlowGazetteer.findNodeById(id, this.view.indexes || {}, this.lang);
          select.appendChild(new Option(node ? `${node.label} (${id})` : id, id));
        });
        li.appendChild(select);
        return li;
      });
      list(H().t('集計値として除外した名前', 'Excluded as aggregates'), report.aggregates, simpleItem);
      if (report.secondary.size) {
        box.appendChild(textEl('p', 'panel-note', H().t(
          `別の辞書で照合：${[...report.secondary].slice(0, 10).join('、')}`,
          `Matched with another gazetteer: ${[...report.secondary].slice(0, 10).join(', ')}`,
        )));
      }
      const notes = [];
      if (report.selfLoops) notes.push(H().t(`同じ地点どうしのフロー ${report.selfLoops} 件を除外`, `${report.selfLoops} self-loops excluded`));
      if (issues.negativeValues) notes.push(H().t(`負の値 ${issues.negativeValues} 件を除外`, `${issues.negativeValues} negative values excluded`));
      if (issues.invalidValues) notes.push(H().t(`数値でない値 ${issues.invalidValues} 件（例：${issues.invalidExamples.join('、')}）`, `${issues.invalidValues} non-numeric values (e.g. ${issues.invalidExamples.join(', ')})`));
      if (issues.totalsExcluded) notes.push(H().t(`合計の行・列 ${issues.totalsExcluded} 件を除外`, `${issues.totalsExcluded} total rows/columns excluded`));
      if (issues.coordinateConflicts.length) notes.push(H().t(`座標が食い違う地名：${issues.coordinateConflicts.join('、')}`, `Conflicting coordinates: ${issues.coordinateConflicts.join(', ')}`));
      if (issues.invalidCoordinates) notes.push(H().t(`範囲外の座標 ${issues.invalidCoordinates} 件`, `${issues.invalidCoordinates} coordinates out of range`));
      notes.forEach((n) => box.appendChild(textEl('p', 'panel-note', n)));
    }

    // ---------- export ----------

    async exportImage(kind) {
      if (!this.rows.length) return;
      H().dvzShowProcessingToast(H().t('書き出し中です', 'Exporting'));
      try {
        if (kind === 'svg') await H().exportSvg(this.config.exportName);
        else await H().exportPng(this.config.exportName);
      } catch (error) {
        H().dvzShowToast(error.message || String(error), 'error');
      }
    }

    exportCsv() {
      const rows = this.view.csvRows();
      if (!rows.length) return;
      H().dvzShowProcessingToast(H().t('書き出し中です', 'Exporting'));
      const text = d3.csvFormat(rows);
      H().downloadBlob(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }), `${this.config.exportName}.csv`);
    }

    exportJson() {
      const payload = this.getChartData();
      if (!payload) return;
      H().dvzShowProcessingToast(H().t('書き出し中です', 'Exporting'));
      H().downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${this.config.exportName}.json`);
    }
  }

  function textEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function renderSource(el, source, sourceUrl) {
    if (!el) return;
    el.replaceChildren();
    const sourceBody = String(source).replace(/^(?:出典[:：]|Source:)\s*/i, '');
    if (!sourceBody) return;
    el.appendChild(document.createTextNode(H().t('出典: ', 'Source: ')));
    if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
      const link = document.createElement('a');
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = sourceBody;
      el.appendChild(link);
    } else {
      el.appendChild(document.createTextNode(sourceBody));
    }
  }

  // Same normalisation for project restore and share.html.
  function normalizePayload(payload) {
    const spec = SPEC();
    const normalized = root.DVZSettingsCompat?.normalize
      ? root.DVZSettingsCompat.normalize(payload || {}, spec)
      : { ...(payload || {}), settings: { ...Settings().defaultSettings(), ...(payload?.settings || {}) } };
    const settings = { ...Settings().defaultSettings(), ...(normalized.settings || {}) };
    settings.annotateTitle = H().pickAnnotationValue(payload?.annotateTitle, settings.annotateTitle);
    settings.annotateSource = H().pickAnnotationValue(payload?.annotateSource, settings.annotateSource);
    settings.annotateSourceUrl = H().pickAnnotationValue(payload?.annotateSourceUrl, settings.annotateSourceUrl);
    settings.legendPosition = H().pickAnnotationValue(payload?.legendPosition, settings.legendPosition) || 'bottom-right';
    const rows = payloadToRows(normalized.data);
    return { ...normalized, settings: Settings().sanitizeSettings(settings, rows.columns) };
  }

  root.FlowMapApp = FlowMapApp;
  root.FlowMapPayload = { rowsToPayload, payloadToRows, normalizePayload, renderSource };
})(typeof window !== 'undefined' ? window : globalThis);
