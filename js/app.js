(function () {
  'use strict';

  const isEmbedMode = new URLSearchParams(location.search).get('embed') === '1';

  function getAuthHeaderBottom() {
    const authHeader = document.querySelector('dataviz-header');
    const bottom = Math.round(authHeader?.getBoundingClientRect?.().bottom || 0);
    return bottom || (isEmbedMode ? 0 : 48);
  }

  function isToolHeaderVisible(header) {
    if (!header || header.hidden) return false;
    const style = window.getComputedStyle?.(header);
    return style?.display !== 'none';
  }

  function getShellOffsetBottom() {
    const header = document.querySelector('dataviz-tool-header');
    if (isEmbedMode) return 0;
    if (isToolHeaderVisible(header)) {
      const toolHeaderBottom = Math.round(header.getBoundingClientRect().bottom || 0);
      if (toolHeaderBottom > 0) return toolHeaderBottom;
    }
    return getAuthHeaderBottom();
  }

  function adjustAppOffset() {
    const app = document.querySelector('.dvz-app');
    if (!app) return;
    const bottom = getShellOffsetBottom();
    const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const nextTop = `${bottom}px`;
    if (app.style.top !== nextTop) app.style.top = nextTop;
    if (viewportHeight > bottom) {
      const nextHeight = `${viewportHeight - bottom}px`;
      if (app.style.height !== nextHeight) app.style.height = nextHeight;
    }
  }

  function scheduleAppOffsetAdjust() {
    adjustAppOffset();
    requestAnimationFrame(() => {
      adjustAppOffset();
      requestAnimationFrame(adjustAppOffset);
    });
    window.setTimeout(adjustAppOffset, 120);
  }

  function mountHeaderOffsetWatchers() {
    scheduleAppOffsetAdjust();

    const resizeTargets = new Set();
    const observeResize = (observer, target) => {
      if (!target || resizeTargets.has(target)) return;
      resizeTargets.add(target);
      observer.observe(target);
    };

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(adjustAppOffset);
      observeResize(resizeObserver, document.querySelector('dataviz-header'));
      observeResize(resizeObserver, document.querySelector('dataviz-tool-header'));
      observeResize(resizeObserver, document.body);
    }

    if (typeof MutationObserver === 'function') {
      const headerObserver = new MutationObserver(scheduleAppOffsetAdjust);
      const observedHeaders = new Set();
      const observeHeader = (header) => {
        if (!header || observedHeaders.has(header)) return;
        observedHeaders.add(header);
        headerObserver.observe(header, {
          attributes: true,
          attributeFilter: ['hidden', 'style', 'class'],
        });
        if (resizeObserver) observeResize(resizeObserver, header);
      };

      let observedApp = null;
      const appObserver = new MutationObserver(scheduleAppOffsetAdjust);
      const observeApp = () => {
        const app = document.querySelector('.dvz-app');
        if (!app || app === observedApp) return;
        observedApp = app;
        appObserver.observe(app, {
          attributes: true,
          attributeFilter: ['style', 'class', 'data-dvz-view'],
        });
      };

      observeHeader(document.querySelector('dataviz-header'));
      observeHeader(document.querySelector('dataviz-tool-header'));
      observeApp();

      const shellObserver = new MutationObserver(() => {
        observeHeader(document.querySelector('dataviz-header'));
        observeHeader(document.querySelector('dataviz-tool-header'));
        observeApp();
        scheduleAppOffsetAdjust();
      });
      shellObserver.observe(document.body, {
        childList: true,
      });
    }

    window.addEventListener('resize', scheduleAppOffsetAdjust);
    window.visualViewport?.addEventListener('resize', scheduleAppOffsetAdjust);
  }

  window.DVZToolHeaderVisibility = {
    adjust: adjustAppOffset,
    scheduleAdjust: scheduleAppOffsetAdjust,
  };

  // The shared editor shell and sidebar load from the id host; fall back to the
  // bundled copies in lib/ when that host is unreachable.
  function loadLocal(globalName, src) {
    if (window[globalName]) return Promise.resolve();
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => {
        console.warn(`[weighted-directed-flow-map] ${src} failed to load`);
        resolve();
      };
      document.body.appendChild(script);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    mountHeaderOffsetWatchers();
    await Promise.all([
      loadLocal('DVZEditorShell', 'lib/dvz-editor-shell.v1.js'),
      loadLocal('DVZSettingSidebar', 'lib/dvz-setting-sidebar.v1.js'),
    ]);
    const app = new window.FlowMapApp();
    window.flowMapApp = app;
    app.init();
    scheduleAppOffsetAdjust();
  });
})();
