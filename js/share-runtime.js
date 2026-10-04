(function () {
  'use strict';

  const H = window.FlowMapHelpers;
  const shareShell = window.DVZShareShell;
  if (!shareShell) throw new Error('DVZShareShell is required');

  // DatavizLocale decides the language; the shell's own fallback is not used.
  const LANG = H.resolveLocale();
  document.documentElement.lang = LANG;
  const parsedRoute = shareShell.parseShareRoute({ lang: LANG });
  const IS_EMBED = new URLSearchParams(location.search).get('embed') === '1';
  shareShell.initEmbedMode(IS_EMBED);

  const fetchShareData = shareShell.createShareDataFetcher({
    supabaseUrl: H.DVZ_SUPABASE_URL,
    supabaseAnonKey: H.DVZ_SUPABASE_ANON_KEY,
    shareTable: H.TOOL_CONFIG.shareTable,
    restTimeoutMs: 8000,
    clientTimeoutMs: 10000,
    logPrefix: '[weighted-directed-flow-map share]',
  });
  const { showLoading, showError, showContent } = shareShell.createUi({ lang: LANG, contentDisplay: 'block' });

  function unwrapConfig(config) {
    if (config?.chartData && typeof config.chartData === 'object') {
      return { ...config.chartData, chartType: config.chartType || config.chartData.chartType };
    }
    return config;
  }

  function setMeta(selector, value) {
    document.querySelector(selector)?.setAttribute('content', value);
  }

  function localizeFooter() {
    if (LANG !== 'en') return;
    const cta = document.getElementById('dvz-cta-link');
    if (cta) cta.textContent = 'Make your own flow map';
    const tool = document.getElementById('dvz-tool-link');
    if (tool) tool.textContent = H.TOOL_CONFIG.titleEn;
  }

  async function main() {
    localizeFooter();
    if (IS_EMBED) {
      document.querySelectorAll('.dvz-cta a, .dvz-site-links a').forEach((a) => {
        a.target = '_blank';
        a.rel = 'noopener';
      });
    } else if (typeof window.gtag !== 'function') {
      H.dvzInitGA(H.TOOL_CONFIG.gaId);
    }
    if (!parsedRoute.ok) {
      showError(parsedRoute.message || (LANG === 'ja' ? 'URLが不正です' : 'Invalid URL'));
      return;
    }
    showLoading();
    try {
      const share = await fetchShareData(parsedRoute.shareId);
      if (!share) throw new Error(LANG === 'ja' ? 'シェアデータが見つかりません' : 'Shared chart not found');
      const config = unwrapConfig(shareShell.normalizeSharedConfig(share.chart_config));
      if (config?.chartType && config.chartType !== window.FlowMapSettings.CHART_TYPE) {
        throw new Error(LANG === 'ja' ? '不明なチャートタイプです' : 'Unknown chart type');
      }
      const normalized = window.FlowMapPayload.normalizePayload(config);
      const settings = normalized.settings;
      settings.annotateTitle = H.pickAnnotationValue(settings.annotateTitle, share.title);
      const rows = window.FlowMapPayload.payloadToRows(normalized.data);
      if (!rows.length) throw new Error(LANG === 'ja' ? 'データがありません' : 'No data');

      const title = settings.annotateTitle || H.toolTitle();
      document.title = `${title} | ${H.toolTitle()}`;
      setMeta('meta[property="og:title"]', title);
      setMeta('meta[name="twitter:title"]', title);
      setMeta('meta[name="description"]', settings.annotateSource || H.toolTitle());
      setMeta('meta[property="og:description"]', settings.annotateSource || H.toolTitle());
      document.getElementById('chart-title').textContent = settings.annotateTitle || '';
      window.FlowMapPayload.renderSource(document.getElementById('chart-source'), settings.annotateSource, settings.annotateSourceUrl);

      showContent();
      await shareShell.nextFrame?.();
      const view = new window.FlowMapView({
        container: document.getElementById('chart-container'),
        controlsEl: document.getElementById('dvz-controls'),
        lang: LANG,
      });
      await view.prepare();
      view.setRows(rows);
      await view.update(settings, { animate: false });
      view.captureBaseline();
      window.flowMapShareView = view;
    } catch (error) {
      console.error('[weighted-directed-flow-map share] failed', error);
      showError(error.message || (LANG === 'ja' ? '読み込みに失敗しました' : 'Failed to load chart'));
    }
  }

  main();
})();
