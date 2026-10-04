(function (global) {
  'use strict';

  const SHARE_PATCH_METHODS = [
    '_setupDataPanel',
    '_setupAnnotate',
    '_setupLegend',
    '_setupEmbed',
    '_setupProject',
    '_setupSampleData',
    '_setupEmbedCopy',
    '_applyAnnotation',
  ];

  function resolveLang() {
    const resolver = global.dvzResolveLocale || global.DatavizLocale?.resolve;
    if (typeof resolver === 'function') return resolver();
    return String(global.document?.documentElement?.lang || '').startsWith('en') ? 'en' : 'ja';
  }

  function parseShareRoute(options) {
    const lang = (options && options.lang) || resolveLang();
    const search = (options && options.search) || global.location.search;
    if (global.DVZBuilderRouting && typeof global.DVZBuilderRouting.parseShareRoute === 'function') {
      return global.DVZBuilderRouting.parseShareRoute(search);
    }
    return {
      ok: false,
      message: lang === 'ja' ? 'URL解析に失敗しました' : 'Failed to parse URL',
    };
  }

  function initEmbedMode(isEmbed) {
    if (!isEmbed) {
      return {
        refresh: function refresh() {},
        destroy: function destroy() {},
      };
    }

    document.documentElement.classList.add('dvz-embed');

    let frameId = 0;
    let resizeObserver = null;

    function postHeight() {
      if (!global.parent || global.parent === global) return;
      global.parent.postMessage(
        { type: 'dvz-resize', height: document.documentElement.scrollHeight },
        '*'
      );
    }

    function schedulePostHeight() {
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = global.requestAnimationFrame(() => {
        frameId = 0;
        postHeight();
      });
    }

    if (typeof global.ResizeObserver === 'function') {
      resizeObserver = new global.ResizeObserver(schedulePostHeight);
      resizeObserver.observe(document.documentElement);
      if (document.body) resizeObserver.observe(document.body);
    }

    global.addEventListener('load', schedulePostHeight);
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(schedulePostHeight).catch(function () {});
    }

    schedulePostHeight();

    return {
      refresh: schedulePostHeight,
      destroy: function destroy() {
        if (frameId) {
          global.cancelAnimationFrame(frameId);
          frameId = 0;
        }
        if (resizeObserver) resizeObserver.disconnect();
        global.removeEventListener('load', schedulePostHeight);
      },
    };
  }

  function resolveDvzAppCtor() {
    if (global.DvzApp && global.DvzApp.prototype) return global.DvzApp;
    if (typeof DvzApp !== 'undefined' && DvzApp && DvzApp.prototype) return DvzApp;
    return null;
  }

  function patchDvzAppForShare() {
    const ctor = resolveDvzAppCtor();
    if (!ctor || !ctor.prototype) return;

    SHARE_PATCH_METHODS.forEach((methodName) => {
      const noop = function noop() {};
      noop.__dvzSharePatched = true;
      ctor.prototype[methodName] = noop;
    });
  }

  function createAssetLoader(options) {
    const assetRev = (options && options.assetRev) ? String(options.assetRev) : '';
    const loadedScripts = new Set();

    function loadScript(src) {
      if (loadedScripts.has(src)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
          loadedScripts.add(src);
          resolve();
        };
        script.onerror = () => reject(new Error('Failed to load ' + src));
        document.body.appendChild(script);
      });
    }

    function loadCSS(href) {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }

    function withAssetRev(src) {
      if (!src || !assetRev) return src;
      if (/^(https?:)?\/\//i.test(src)) return src;
      return `${src}${src.includes('?') ? '&' : '?'}v=${assetRev}`;
    }

    return {
      loadScript,
      loadCSS,
      withAssetRev,
    };
  }

  function renderProxyPanel(panel) {
    const panelClassName = panel.className || 'sidebar-panel';
    const wrapperClassName = panel.wrapperClass || '';
    const wrapper = wrapperClassName
      ? `<div class="${wrapperClassName}" data-dvz-share-slot="true"></div>`
      : '';
    return `<div id="${panel.id}" class="${panelClassName}">${wrapper}</div>`;
  }

  function ensureSidebarProxy(options) {
    const proxyId = (options && options.proxyId) || 'dvz-share-sidebar-proxy';
    const panels = Array.isArray(options && options.panels) ? options.panels : [];
    const meta = (options && options.meta) || {};

    let proxy = document.getElementById(proxyId);
    if (!proxy) {
      proxy = document.createElement('div');
      proxy.id = proxyId;
      proxy.setAttribute('aria-hidden', 'true');
      proxy.style.display = 'none';
      document.body.appendChild(proxy);
    }

    proxy.innerHTML = panels.map(renderProxyPanel).join('\n');

    panels.forEach((panel) => {
      const panelNode = proxy.querySelector(`#${panel.id}`);
      const targetNode = panelNode
        ? (panelNode.querySelector('[data-dvz-share-slot="true"]') || panelNode)
        : null;
      if (targetNode) {
        targetNode.innerHTML = meta[panel.metaKey] || '';
      }
    });

    return proxy;
  }

  function normalizeSharedConfig(config) {
    if (!config || typeof config !== 'object') return config;
    const data = config.data;
    if (!Array.isArray(data) || !data.length) return config;
    if (Array.isArray(data.columns) && data.columns.length) return config;

    const firstRow = data[0];
    if (!firstRow || typeof firstRow !== 'object') return config;

    const keys = Object.keys(firstRow);
    const timeKey = keys.find((key) => /^(year|date|time)$/i.test(key));
    const columns = timeKey
      ? [timeKey, ...keys.filter((key) => key !== timeKey)]
      : keys;

    if (columns.length) data.columns = columns;
    return config;
  }

  function timeoutPromise(ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message || 'Timeout')), ms);
    });
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(
        url,
        Object.assign({}, options || {}, controller ? { signal: controller.signal } : {})
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function createShareDataFetcher(options) {
    const supabaseUrl = options.supabaseUrl;
    const supabaseAnonKey = options.supabaseAnonKey;
    const shareTable = options.shareTable;
    const restTimeoutMs = options.restTimeoutMs || 8000;
    const clientTimeoutMs = options.clientTimeoutMs || 10000;
    const logPrefix = options.logPrefix || '[dvz-share-shell]';
    let shareSupabaseClient = null;

    function getShareSupabaseClient() {
      if (!shareSupabaseClient && global.supabase && typeof global.supabase.createClient === 'function') {
        shareSupabaseClient = global.supabase.createClient(supabaseUrl, supabaseAnonKey);
      }
      return shareSupabaseClient;
    }

    async function fetchShareViaRest(shareId) {
      const params = new URLSearchParams({
        select: '*',
        id: `eq.${shareId}`,
        apikey: supabaseAnonKey,
      });
      const endpoint = `${supabaseUrl}/rest/v1/${shareTable}?${params.toString()}`;
      const rows = await fetchJsonWithTimeout(endpoint, {}, restTimeoutMs);
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    async function fetchShareViaClient(shareId) {
      const client = getShareSupabaseClient();
      if (!client) {
        throw new Error('Supabase client unavailable');
      }
      const result = await Promise.race([
        client.from(shareTable).select('*').eq('id', shareId).single(),
        timeoutPromise(clientTimeoutMs, 'Supabase query timed out'),
      ]);
      const data = result && result.data;
      const error = result && result.error;
      if (error) throw error;
      return data || null;
    }

    return async function fetchShareData(shareId) {
      let restError = null;
      try {
        return await fetchShareViaRest(shareId);
      } catch (error) {
        restError = error;
        console.warn(`${logPrefix} REST fetch failed, fallback to supabase-js:`, error);
      }

      try {
        return await fetchShareViaClient(shareId);
      } catch (clientError) {
        console.error(`${logPrefix} supabase-js fallback failed:`, clientError);
        if (restError) console.error(`${logPrefix} initial REST error:`, restError);
        throw clientError;
      }
    };
  }

  function createUi(options) {
    const lang = (options && options.lang) || resolveLang();
    const contentDisplay = (options && options.contentDisplay) || 'flex';
    const loadingMessage = (options && options.loadingMessage)
      || (lang === 'ja' ? '読み込み中...' : 'Loading...');

    function getNode(id) {
      return document.getElementById(id);
    }

    return {
      showLoading: function showLoading(message) {
        const loading = getNode('dvz-loading');
        const error = getNode('dvz-error');
        const content = getNode('dvz-content');
        if (loading) {
          loading.textContent = message || loadingMessage;
          loading.style.display = '';
        }
        if (error) {
          error.textContent = '';
          error.style.display = 'none';
        }
        if (content) {
          content.style.display = 'none';
        }
      },
      showError: function showError(message) {
        const loading = getNode('dvz-loading');
        const error = getNode('dvz-error');
        const content = getNode('dvz-content');
        if (loading) loading.style.display = 'none';
        if (error) {
          error.textContent = message || '';
          error.style.display = '';
        }
        if (content) {
          content.style.display = 'none';
        }
      },
      showContent: function showContent() {
        const loading = getNode('dvz-loading');
        const error = getNode('dvz-error');
        const content = getNode('dvz-content');
        if (loading) loading.style.display = 'none';
        if (error) error.style.display = 'none';
        if (content) {
          content.style.display = contentDisplay;
        }
      },
    };
  }

  function nextFrame() {
    return new Promise((resolve) => global.requestAnimationFrame(() => resolve()));
  }

  global.DVZShareShell = global.DVZShareShell || {};
  global.DVZShareShell.resolveLang = resolveLang;
  global.DVZShareShell.parseShareRoute = parseShareRoute;
  global.DVZShareShell.initEmbedMode = initEmbedMode;
  global.DVZShareShell.patchDvzAppForShare = patchDvzAppForShare;
  global.DVZShareShell.createAssetLoader = createAssetLoader;
  global.DVZShareShell.ensureSidebarProxy = ensureSidebarProxy;
  global.DVZShareShell.normalizeSharedConfig = normalizeSharedConfig;
  global.DVZShareShell.timeoutPromise = timeoutPromise;
  global.DVZShareShell.fetchJsonWithTimeout = fetchJsonWithTimeout;
  global.DVZShareShell.createShareDataFetcher = createShareDataFetcher;
  global.DVZShareShell.createUi = createUi;
  global.DVZShareShell.nextFrame = nextFrame;
})(window);
