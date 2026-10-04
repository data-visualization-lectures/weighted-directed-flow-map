(function (global) {
  'use strict';

  function roundPx(value) {
    return Number.isFinite(value) ? Math.round(value) : 0;
  }

  function getViewportHeight() {
    return roundPx(
      (global.visualViewport && global.visualViewport.height)
      || global.innerHeight
      || document.documentElement.clientHeight
      || 0
    );
  }

  function createMount(config) {
    const appSelector = config.appSelector || '.dvz-app';
    const headerSelector = config.headerSelector || 'dataviz-tool-header';
    let frameId = 0;
    let headerNode = null;
    let resizeObserver = null;
    let mutationObserver = null;

    function applyLayout() {
      const app = document.querySelector(appSelector);
      if (!app) return;

      const header = document.querySelector(headerSelector);
      const bottom = roundPx(header ? header.getBoundingClientRect().bottom : 0);
      const viewportHeight = getViewportHeight();

      app.style.top = `${bottom}px`;
      if (viewportHeight > bottom) {
        app.style.height = `${viewportHeight - bottom}px`;
      } else {
        app.style.height = '';
      }
    }

    function scheduleLayout() {
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = global.requestAnimationFrame(() => {
        frameId = 0;
        bindHeaderObserver();
        applyLayout();
      });
    }

    function bindHeaderObserver() {
      if (!resizeObserver) return;
      const nextHeader = document.querySelector(headerSelector);
      if (nextHeader === headerNode) return;
      if (headerNode) {
        resizeObserver.unobserve(headerNode);
      }
      headerNode = nextHeader;
      if (headerNode) {
        resizeObserver.observe(headerNode);
      }
    }

    function destroy() {
      if (frameId) {
        global.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      if (resizeObserver) {
        if (headerNode) resizeObserver.unobserve(headerNode);
        resizeObserver.disconnect();
      }
      if (mutationObserver) mutationObserver.disconnect();
      global.removeEventListener('resize', scheduleLayout);
      if (global.visualViewport) {
        global.visualViewport.removeEventListener('resize', scheduleLayout);
      }
    }

    if (typeof global.ResizeObserver === 'function') {
      resizeObserver = new global.ResizeObserver(scheduleLayout);
      resizeObserver.observe(document.documentElement);
      bindHeaderObserver();
    }

    if (typeof global.MutationObserver === 'function') {
      mutationObserver = new global.MutationObserver(bindHeaderObserver);
      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    global.addEventListener('resize', scheduleLayout);
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', scheduleLayout);
    }

    scheduleLayout();

    return {
      refresh: scheduleLayout,
      destroy,
    };
  }

  global.DVZEditorShell = global.DVZEditorShell || {};
  global.DVZEditorShell.mount = function mount(options) {
    return createMount(options || {});
  };
})(window);
