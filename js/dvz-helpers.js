(function (root) {
  'use strict';

  const TOOL_CONFIG = {
    appName: 'weighted-directed-flow-map',
    title: '重み付き有向フローマップ',
    titleEn: 'Weighted Directed Flow Map',
    gaId: 'G-7NYMBRBRWZ',
    exportName: 'weighted-directed-flow-map',
    shareTable: 'weighted_directed_flow_map_shares',
    publicShareOrigin: 'https://weighted-directed-flow-map.dataviz.jp',
    publishFunction: 'publish-weighted-directed-flow-map-share',
    marketingUrl: 'https://www.dataviz.jp/weighted-directed-flow-map/',
  };

  const DVZ_SUPABASE_URL = 'https://vebhoeiltxspsurqoxvl.supabase.co';
  const DVZ_SUPABASE_ANON_KEY = 'sb_publishable_sAjwbAhC0jnIRjNa34QuTA_CcksMYQG';

  function resolveLocale() {
    try {
      const lang = new URLSearchParams(location.search).get('lang');
      if (lang === 'en' || lang === 'ja') return lang;
    } catch (_) { /* ignore */ }
    const resolver = root.dvzResolveLocale || root.DatavizLocale?.resolve;
    if (typeof resolver === 'function') {
      return resolver() === 'en' ? 'en' : 'ja';
    }
    const htmlLang = String(document.documentElement?.lang || '').toLowerCase();
    return htmlLang.startsWith('en') ? 'en' : 'ja';
  }

  function t(ja, en) {
    return resolveLocale() === 'en' ? en : ja;
  }

  function toolTitle() {
    return resolveLocale() === 'en' ? TOOL_CONFIG.titleEn : TOOL_CONFIG.title;
  }

  const I18N = {
    ja: {
      sidebarLabel: 'チャート設定',
      tabData: 'データ', tabMapping: 'マッピング', tabStyle: 'スタイル', tabAnnotate: '注釈', tabExport: '出力',
      tabSelect: 'タブを選択',
      emptyState: 'エッジリスト（出発・到着・値）または OD 行列を読み込んでください',
      upload: 'アップロード',
      dropPrimary: 'CSV / TSV / JSON をドロップ',
      dropSecondary: 'またはクリックして選択',
      loadedData: '読込済みデータ',
      dataPreview: 'データプレビュー（先頭5行）',
      noData: 'データ未読込',
      noPreview: 'プレビューできるデータがありません',
      badgeSample: 'サンプル', badgeUpload: 'アップロード', badgeProject: 'プロジェクト', badgeUrl: 'URL',
      rows: '行', cols: '列',
      mapInputFormat: 'データ形式', formatAuto: '自動判定', formatEdgeList: 'エッジリスト（出発・到着・値）', formatMatrix: 'OD 行列（行＝出発、列＝到着）',
      mapFrom: '出発地', mapTo: '到着地', mapValue: '値（太さ）', mapGroup: '分類・期間（任意）',
      mapCoords: '緯度経度列（任意）', mapFromLat: '出発 緯度', mapFromLon: '出発 経度', mapToLat: '到着 緯度', mapToLon: '到着 経度',
      mapMatrixLabel: '行ラベルの列', mapOrientation: '向き', orientRowsOrigin: '行＝出発、列＝到着', orientColsOrigin: '列＝出発、行＝到着',
      mapExcludeTotals: '合計の行・列を除外',
      mapGazetteer: '地点の照合', gazAuto: '自動', gazJp: '日本の都道府県', gazCountries: '世界の国・地域', gazCities: '世界の主要都市・日本の市', gazCoords: '緯度経度列のみ',
      matchReport: '地点の照合結果',
      optNone: '（なし）', optCount: '（行数を数える）', firstColumn: '(1列目)',
      styleBasemap: '基図', basemapAuto: '自動', basemapWorld: '世界', basemapJapan: '日本（都道府県）', basemapNone: 'なし',
      styleProjection: '投影法', projAuto: '自動', projMercator: 'メルカトル', projConic: '正角円錐',
      styleCenter: '中心経度', centerAuto: 'データから自動', centerManual: '指定',
      styleExtent: '表示範囲', extentNodes: '地点に合わせる', extentBasemap: '基図全体',
      styleOkinawa: '沖縄を左上に移す（枠付き）',
      styleShape: '向きの表現', shapeArrow: '均一幅＋矢尻', shapeTapered: '先細り', shapeTaperedArrow: '先細り＋矢尻', shapeTaperedCenter: '先細り＋中央矢印線',
      styleCurvature: '曲がり具合', styleMaxWidth: '最大の太さ（px）', styleMinWidth: '最小の太さ（px）',
      styleWidthScale: '太さの尺度', scaleLinear: '比例', scaleSqrt: '平方根',
      styleTopN: '表示件数（上位）', styleKeepPairs: '往復はまとめて残す', styleMinValue: '最小値',
      styleColorMode: 'フローの色', colorSingle: '単色', colorValue: '値の大小', colorAsymmetry: '往復の差', colorOrigin: '出発地別', colorDestination: '到着地別',
      styleFlowColor: '色', styleScheme: '配色', styleOpacity: '不透明度',
      styleNodeSize: '地点の大きさ', nodeSizeNone: '固定', nodeSizeTotal: '流入＋流出', nodeSizeIn: '流入', nodeSizeOut: '流出',
      styleNodeMax: '地点の最大半径（px）', styleNodeColor: '地点の色', nodeColorNet: '純流入（流入超過・流出超過）', nodeColorSingle: '単色',
      styleLabels: 'ラベル', labelTop: '上位の地点', labelAll: 'すべて', labelNone: 'なし', styleLabelTop: 'ラベルを付ける件数',
      annotateTitle: 'タイトル', annotateTitlePlaceholder: 'チャートタイトル',
      annotateSource: '出典', annotateSourcePlaceholder: 'データソース名', annotateSourceUrl: '出典URL',
      annotateUnit: '値の単位', annotateUnitPlaceholder: '例：人、千円',
      annotateLegend: '凡例', legendBottomRight: '右下', legendBottomLeft: '左下', legendTopRight: '右上', legendTopLeft: '左上', legendNone: 'なし',
      apply: '適用',
      exportImage: '画像', exportData: 'データ',
    },
    en: {
      sidebarLabel: 'Chart settings',
      tabData: 'Data', tabMapping: 'Mapping', tabStyle: 'Style', tabAnnotate: 'Annotate', tabExport: 'Export',
      tabSelect: 'Select a tab',
      emptyState: 'Load an edge list (origin, destination, value) or an origin-destination matrix',
      upload: 'Upload',
      dropPrimary: 'Drop CSV / TSV / JSON',
      dropSecondary: 'or click to choose a file',
      loadedData: 'Loaded data',
      dataPreview: 'Data preview (first 5 rows)',
      noData: 'No data loaded',
      noPreview: 'Nothing to preview',
      badgeSample: 'Sample', badgeUpload: 'Upload', badgeProject: 'Project', badgeUrl: 'URL',
      rows: 'rows', cols: 'columns',
      mapInputFormat: 'Data format', formatAuto: 'Detect automatically', formatEdgeList: 'Edge list (origin, destination, value)', formatMatrix: 'OD matrix (rows = origin, columns = destination)',
      mapFrom: 'Origin', mapTo: 'Destination', mapValue: 'Value (width)', mapGroup: 'Group / period (optional)',
      mapCoords: 'Coordinate columns (optional)', mapFromLat: 'Origin lat', mapFromLon: 'Origin lon', mapToLat: 'Destination lat', mapToLon: 'Destination lon',
      mapMatrixLabel: 'Row label column', mapOrientation: 'Orientation', orientRowsOrigin: 'Rows = origin, columns = destination', orientColsOrigin: 'Columns = origin, rows = destination',
      mapExcludeTotals: 'Exclude total rows and columns',
      mapGazetteer: 'Place matching', gazAuto: 'Automatic', gazJp: 'Japanese prefectures', gazCountries: 'Countries and territories', gazCities: 'Major world cities and Japanese cities', gazCoords: 'Coordinate columns only',
      matchReport: 'Place matching result',
      optNone: '(none)', optCount: '(count rows)', firstColumn: '(column 1)',
      styleBasemap: 'Basemap', basemapAuto: 'Automatic', basemapWorld: 'World', basemapJapan: 'Japan (prefectures)', basemapNone: 'None',
      styleProjection: 'Projection', projAuto: 'Automatic', projMercator: 'Mercator', projConic: 'Conic conformal',
      styleCenter: 'Center longitude', centerAuto: 'From the data', centerManual: 'Manual',
      styleExtent: 'Extent', extentNodes: 'Fit to places', extentBasemap: 'Whole basemap',
      styleOkinawa: 'Move Okinawa to a top-left inset',
      styleShape: 'Direction', shapeArrow: 'Even width + arrowhead', shapeTapered: 'Tapered', shapeTaperedArrow: 'Tapered + arrowhead', shapeTaperedCenter: 'Tapered + center arrow',
      styleCurvature: 'Curvature', styleMaxWidth: 'Max width (px)', styleMinWidth: 'Min width (px)',
      styleWidthScale: 'Width scale', scaleLinear: 'Linear', scaleSqrt: 'Square root',
      styleTopN: 'Flows shown (top)', styleKeepPairs: 'Keep both directions of a pair', styleMinValue: 'Minimum value',
      styleColorMode: 'Flow color', colorSingle: 'Single', colorValue: 'By value', colorAsymmetry: 'Two-way imbalance', colorOrigin: 'By origin', colorDestination: 'By destination',
      styleFlowColor: 'Color', styleScheme: 'Scheme', styleOpacity: 'Opacity',
      styleNodeSize: 'Place size', nodeSizeNone: 'Fixed', nodeSizeTotal: 'In + out', nodeSizeIn: 'Inflow', nodeSizeOut: 'Outflow',
      styleNodeMax: 'Max place radius (px)', styleNodeColor: 'Place color', nodeColorNet: 'Net flow (net in / net out)', nodeColorSingle: 'Single',
      styleLabels: 'Labels', labelTop: 'Top places', labelAll: 'All', labelNone: 'None', styleLabelTop: 'Number of labels',
      annotateTitle: 'Title', annotateTitlePlaceholder: 'Chart title',
      annotateSource: 'Source', annotateSourcePlaceholder: 'Data source name', annotateSourceUrl: 'Source URL',
      annotateUnit: 'Value unit', annotateUnitPlaceholder: 'e.g. people, thousand yen',
      annotateLegend: 'Legend', legendBottomRight: 'Bottom right', legendBottomLeft: 'Bottom left', legendTopRight: 'Top right', legendTopLeft: 'Top left', legendNone: 'None',
      apply: 'Apply',
      exportImage: 'Image', exportData: 'Data',
    },
  };

  function tKey(key) {
    const lang = resolveLocale() === 'en' ? 'en' : 'ja';
    return I18N[lang][key] || I18N.ja[key] || key;
  }

  function dvzApplyI18n() {
    const lang = resolveLocale() === 'en' ? 'en' : 'ja';
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const text = tKey(el.getAttribute('data-i18n'));
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = text;
        return;
      }
      el.textContent = text;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', tKey(el.getAttribute('data-i18n-aria')));
    });
  }

  function pickAnnotationValue(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value;
    }
    for (const value of values) {
      if (typeof value === 'string') return value;
    }
    return '';
  }

  function dvzInitGA(gaId) {
    if (!gaId || root.__dvzGaInitialized) return;
    root.__dvzGaInitialized = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
    document.head.appendChild(script);
    root.dataLayer = root.dataLayer || [];
    root.gtag = root.gtag || function gtag() { root.dataLayer.push(arguments); };
    root.gtag('js', new Date());
    root.gtag('config', gaId);
  }

  function dvzShowToast(msg, type) {
    const header = document.querySelector('dataviz-tool-header');
    if (header && typeof header.showMessage === 'function') {
      header.showMessage(msg, type || 'success');
      return;
    }
    console.log(`[${type || 'info'}] ${msg}`);
  }

  function dvzShowProcessingToast(msg, duration = 5000) {
    const header = document.querySelector('dataviz-tool-header');
    if (header && typeof header.showMessage === 'function') {
      header.showMessage(msg, 'info', duration);
    }
  }

  async function dvzGetDatavizAccessToken() {
    const header = document.querySelector('dataviz-tool-header');
    if (header && typeof header.getAccessToken === 'function') {
      const token = await header.getAccessToken();
      if (token) return token;
    }
    if (root.datavizAuthClient?.getAccessToken) {
      return root.datavizAuthClient.getAccessToken();
    }
    if (root.datavizSupabase?.auth?.getSession) {
      const { data } = await root.datavizSupabase.auth.getSession();
      return data?.session?.access_token || null;
    }
    return null;
  }

  function escapeHtmlAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildPublicSharePageUrl(shareId) {
    return `${TOOL_CONFIG.publicShareOrigin}/share.html?id=${encodeURIComponent(shareId)}`;
  }

  function buildIframeEmbedCode(shareId, rawTitle) {
    const src = `${buildPublicSharePageUrl(shareId)}&embed=1`;
    const base = String(rawTitle || '').trim();
    const name = toolTitle();
    const title = escapeHtmlAttr(base ? `${base} - ${name}` : name);
    const style = [
      'display:block',
      'width:100%',
      'max-width:100%',
      'height:auto',
      'aspect-ratio:16/10',
      'border:0',
      'margin:0 auto',
      'padding:0',
      'overflow:hidden',
      'max-height:calc(100vh - 24px)',
      'max-height:calc(100dvh - 24px)',
    ].join(';');
    return `<iframe title="${title}" src="${src}" frameborder="0" scrolling="auto" allow="fullscreen; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen="true" style="${style}"></iframe>`;
  }

  async function dvzPublishShareFromProject(options = {}) {
    const projectId = String(options.projectId || '').trim();
    if (!projectId) {
      throw new Error(t('シェアする前にプロジェクトを保存してください', 'Save the project before sharing.'));
    }
    const accessToken = await dvzGetDatavizAccessToken();
    if (!accessToken) throw new Error('Login required');

    const response = await fetch(`${DVZ_SUPABASE_URL}/functions/v1/${TOOL_CONFIG.publishFunction}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dataviz-Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        projectId,
        fallbackTitle: String(options.fallbackTitle || '').trim() || null,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || `Share publish failed (${response.status})`);
    }
    return payload || {};
  }

  // Returns rows with a `columns` array that keeps the original header order.
  function parseTableText(text, filename) {
    const name = String(filename || '').toLowerCase();
    const trimmed = String(text || '').replace(/^﻿/, '');
    let rows;
    if (name.endsWith('.json') || /^\s*[[{]/.test(trimmed)) {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) rows = parsed;
      else if (parsed && Array.isArray(parsed.rows)) rows = parsed.rows;
      else if (parsed && Array.isArray(parsed.data)) rows = parsed.data;
      else throw new Error(t('JSON は行オブジェクトの配列にしてください', 'JSON must be an array of row objects'));
      const columns = Array.isArray(parsed?.columns) ? parsed.columns.slice() : (rows[0] ? Object.keys(rows[0]) : []);
      rows = rows.map((row) => {
        const out = {};
        columns.forEach((col) => { out[col] = row[col] == null ? '' : String(row[col]); });
        return out;
      });
      rows.columns = columns;
      return rows;
    }
    if (typeof d3 === 'undefined') throw new Error('d3 is required');
    const firstLine = trimmed.split(/\r?\n/)[0] || '';
    rows = (name.endsWith('.tsv') || (/\t/.test(firstLine) && !/,/.test(firstLine))) ? d3.tsvParse(trimmed) : d3.csvParse(trimmed);
    const seen = new Set();
    const duplicates = rows.columns.filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
    if (duplicates.length) rows.duplicateColumns = duplicates;
    return rows;
  }

  function dvzInitFileUpload(onFileLoaded) {
    const dropzone = document.getElementById('dvz-dropzone');
    const fileInput = document.getElementById('dvz-file-input');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0], onFileLoaded);
      fileInput.value = '';
    });
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      const file = event.dataTransfer.files[0];
      if (file) handleFile(file, onFileLoaded);
    });
  }

  function handleFile(file, onFileLoaded) {
    dvzShowProcessingToast(t('ファイルを読み込んでいます', 'Loading file'));
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = parseTableText(reader.result, file.name);
        onFileLoaded?.({ type: file.name.endsWith('.json') ? 'json' : 'csv', data, filename: file.name, raw: reader.result });
      } catch (error) {
        dvzShowToast(error.message || String(error), 'error');
      }
    };
    reader.readAsText(file);
  }

  function numberLocale() {
    return resolveLocale() === 'en' ? 'en-US' : 'ja-JP';
  }

  function formatNumber(value) {
    if (value == null || !Number.isFinite(value)) return '';
    return new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 2 }).format(value);
  }

  function formatCompact(value) {
    if (value == null || !Number.isFinite(value)) return '';
    return new Intl.NumberFormat(numberLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function withUnit(text, unit) {
    if (!unit) return text;
    return resolveLocale() === 'en' ? `${text} ${unit}` : `${text}${unit}`;
  }

  function colorInterpolator(scheme) {
    const map = {
      blues: d3.interpolateBlues,
      oranges: d3.interpolateOranges,
      greens: d3.interpolateGreens,
      purples: d3.interpolatePurples,
      viridis: d3.interpolateViridis,
      inferno: d3.interpolateInferno,
    };
    return map[scheme] || d3.interpolateBlues;
  }

  /**
   * Tooltip content is built from DOM nodes: labels come from user data.
   * lines: [{ text, strong?, muted? }]
   */
  function showTooltip(event, lines) {
    const el = document.getElementById('tooltip');
    if (!el) return;
    el.replaceChildren();
    lines.forEach((line, i) => {
      if (i > 0) el.appendChild(document.createElement('br'));
      const node = document.createElement(line.strong ? 'strong' : 'span');
      node.textContent = line.text;
      if (line.muted) node.className = 'dvz-tooltip-muted';
      el.appendChild(node);
    });
    el.style.display = 'block';
    const pad = 14;
    const rect = el.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;
  }

  function hideTooltip() {
    const el = document.getElementById('tooltip');
    if (el) el.style.display = 'none';
  }

  function applyLabelStroke(selection) {
    selection
      .attr('fill', '#111827')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .style('fill', '#111827')
      .style('stroke', '#ffffff')
      .style('stroke-width', '3px')
      .style('stroke-linejoin', 'round')
      .style('paint-order', 'stroke');
  }

  function paintIsVisible(value) {
    const text = String(value || '').trim();
    return text !== '' && text !== 'none' && text !== 'transparent';
  }

  function strokeDrawnBeforeFill(order) {
    const tokens = String(order || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens[0] === 'normal') return false;
    const strokeAt = tokens.indexOf('stroke');
    const fillAt = tokens.indexOf('fill');
    if (strokeAt < 0) return false;
    if (fillAt < 0) return true;
    return strokeAt < fillAt;
  }

  function isOutlinedExportText(el, style) {
    const order = style.getPropertyValue('paint-order') || el.getAttribute('paint-order') || '';
    if (!strokeDrawnBeforeFill(order)) return false;
    const strokeWidth = parseFloat(style.getPropertyValue('stroke-width'));
    const strokeOpacity = parseFloat(style.getPropertyValue('stroke-opacity') || '1');
    return paintIsVisible(style.getPropertyValue('fill'))
      && paintIsVisible(style.getPropertyValue('stroke'))
      && strokeWidth > 0
      && strokeOpacity !== 0;
  }

  function setExportPaint(el, name, value) {
    el.style.setProperty(name, value);
    el.setAttribute(name, value);
  }

  function clearExportPaintOrder(el) {
    el.style.removeProperty('paint-order');
    el.removeAttribute('paint-order');
  }

  function collectExportTextPairs(src, clone, pairs) {
    if (!src || !clone || src.nodeType !== 1 || clone.nodeType !== 1) return;
    if (src.localName === 'text') {
      pairs.push([src, clone]);
      return;
    }
    const count = Math.min(src.children.length, clone.children.length);
    for (let i = 0; i < count; i += 1) {
      collectExportTextPairs(src.children[i], clone.children[i], pairs);
    }
  }

  // Illustrator ignores paint-order, so outlined labels are split only on the export clone.
  function splitOutlinedTextForExport(srcRoot, cloneRoot) {
    const pairs = [];
    collectExportTextPairs(srcRoot, cloneRoot, pairs);
    pairs.forEach(([src, clone]) => {
      if (!clone.parentNode || typeof window.getComputedStyle !== 'function') return;
      const style = window.getComputedStyle(src);
      if (!isOutlinedExportText(src, style)) return;

      const strokeEl = clone.cloneNode(true);
      const fillEl = clone.cloneNode(true);
      clearExportPaintOrder(strokeEl);
      clearExportPaintOrder(fillEl);

      setExportPaint(strokeEl, 'fill', 'none');
      setExportPaint(strokeEl, 'stroke', style.getPropertyValue('stroke'));
      setExportPaint(strokeEl, 'stroke-width', style.getPropertyValue('stroke-width'));
      setExportPaint(strokeEl, 'stroke-linejoin', style.getPropertyValue('stroke-linejoin') || 'round');
      const strokeOpacity = style.getPropertyValue('stroke-opacity');
      if (strokeOpacity) setExportPaint(strokeEl, 'stroke-opacity', strokeOpacity);

      setExportPaint(fillEl, 'fill', style.getPropertyValue('fill'));
      setExportPaint(fillEl, 'stroke', 'none');
      fillEl.style.removeProperty('stroke-width');
      fillEl.removeAttribute('stroke-width');

      clone.replaceWith(strokeEl);
      strokeEl.after(fillEl);
    });
  }

  // Basemap strokes use vector-effect on screen; bake the zoomed width for export.
  function bakeNonScalingStrokes(cloneRoot) {
    cloneRoot.querySelectorAll('[data-export-k]').forEach((group) => {
      const k = Number(group.getAttribute('data-export-k')) || 1;
      group.querySelectorAll('[vector-effect]').forEach((el) => {
        const sw = Number(el.getAttribute('stroke-width')) || 0;
        el.removeAttribute('vector-effect');
        el.style.removeProperty('vector-effect');
        if (sw) el.setAttribute('stroke-width', String(sw / k));
      });
    });
    cloneRoot.querySelectorAll('[data-export-remove]').forEach((el) => el.remove());
  }

  function cloneChartSvg(svg) {
    const clone = svg.cloneNode(true);
    splitOutlinedTextForExport(svg, clone);
    bakeNonScalingStrokes(clone);
    return clone;
  }

  function chartSvg() {
    return document.querySelector('#chart-container svg.wdfm-svg');
  }

  async function exportSvg(filename) {
    const svg = chartSvg();
    if (!svg) throw new Error('No chart');
    const clone = cloneChartSvg(svg);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `${filename}.svg`);
  }

  async function rasterize(svg, targetWidth, scale) {
    const clone = cloneChartSvg(svg);
    const width = svg.viewBox.baseVal.width || svg.clientWidth || 800;
    const height = svg.viewBox.baseVal.height || svg.clientHeight || 600;
    const outW = targetWidth ? targetWidth : width * scale;
    const outH = targetWidth ? Math.round((targetWidth * height) / width) : height * scale;
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function exportPng(filename) {
    const svg = chartSvg();
    if (!svg) throw new Error('No chart');
    const canvas = await rasterize(svg, null, 2);
    await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        downloadBlob(blob, `${filename}.png`);
        resolve();
      }, 'image/png');
    });
  }

  async function generateThumbnail() {
    const svg = chartSvg();
    if (!svg) return null;
    const canvas = await rasterize(svg, 640, 1);
    return canvas.toDataURL('image/png');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  root.FlowMapHelpers = {
    TOOL_CONFIG,
    DVZ_SUPABASE_URL,
    DVZ_SUPABASE_ANON_KEY,
    resolveLocale,
    t,
    tKey,
    toolTitle,
    dvzApplyI18n,
    pickAnnotationValue,
    dvzInitGA,
    dvzShowToast,
    dvzShowProcessingToast,
    dvzPublishShareFromProject,
    buildPublicSharePageUrl,
    buildIframeEmbedCode,
    parseTableText,
    dvzInitFileUpload,
    formatNumber,
    formatCompact,
    withUnit,
    colorInterpolator,
    showTooltip,
    hideTooltip,
    applyLabelStroke,
    cloneChartSvg,
    exportSvg,
    exportPng,
    generateThumbnail,
    downloadBlob,
  };

  root.dvzInitGA = dvzInitGA;
  root.dvzApplyI18n = dvzApplyI18n;
  root.dvzShowToast = dvzShowToast;
  root.dvzShowProcessingToast = dvzShowProcessingToast;
  root.dvzInitFileUpload = dvzInitFileUpload;
  root.dvzPublishShareFromProject = dvzPublishShareFromProject;
})(typeof window !== 'undefined' ? window : globalThis);
