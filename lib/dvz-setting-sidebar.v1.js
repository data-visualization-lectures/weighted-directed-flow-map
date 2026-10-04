(function initDVZSettingSidebar(global) {
  'use strict';

  const VERSION = '1.0.0';
  let instanceCount = 0;

  function asArray(value) {
    return Array.prototype.slice.call(value || []);
  }

  function resolveElement(value, scope) {
    if (!value) return null;
    if (typeof value === 'string') return (scope || document).querySelector(value);
    return value;
  }

  function tabIdOf(tab) {
    return String(tab?.dataset?.tab || tab?.getAttribute?.('aria-controls') || '').trim();
  }

  function dispatchChange(root, detail) {
    if (!root || typeof root.dispatchEvent !== 'function') return;
    let event;
    if (typeof global.CustomEvent === 'function') {
      event = new global.CustomEvent('dvz-setting-sidebar:change', { bubbles: true, detail });
    } else if (document.createEvent) {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent('dvz-setting-sidebar:change', true, false, detail);
    }
    if (event) root.dispatchEvent(event);
  }

  function renderTabs(root, tabs, labels) {
    const doc = root.ownerDocument || document;
    const selectWrap = doc.createElement('div');
    const select = doc.createElement('select');
    const tabList = doc.createElement('div');
    const panels = doc.createElement('div');

    root.replaceChildren();
    root.classList.add('dvz-setting-sidebar');
    root.setAttribute('data-dvz-setting-sidebar', '');
    selectWrap.className = 'dvz-setting-sidebar__select-wrap';
    select.className = 'dvz-setting-sidebar__select';
    select.setAttribute('data-dvz-setting-tab-select', '');
    select.setAttribute('aria-label', labels?.select || 'Select a settings tab');
    tabList.className = 'dvz-setting-sidebar__tabs';
    tabList.setAttribute('data-dvz-setting-tabs', '');
    panels.className = 'dvz-setting-sidebar__panels';
    panels.setAttribute('data-dvz-setting-panels', '');

    for (const item of tabs) {
      if (!item || !item.id) throw new Error('DVZSettingSidebar: each tab needs an id');
      const tabId = String(item.id);
      const label = String(item.label || item.id);
      const option = doc.createElement('option');
      const button = doc.createElement('button');
      const panel = doc.createElement('section');

      option.value = tabId;
      option.textContent = label;
      select.appendChild(option);

      button.type = 'button';
      button.className = 'dvz-setting-sidebar__tab';
      button.setAttribute('data-dvz-setting-tab', '');
      button.dataset.tab = tabId;
      button.textContent = label;
      tabList.appendChild(button);

      panel.id = tabId;
      panel.className = 'dvz-setting-sidebar__panel';
      panel.setAttribute('data-dvz-setting-panel', '');
      if (typeof item.render === 'function') {
        item.render(panel);
      } else if (item.content && typeof panel.appendChild === 'function') {
        panel.appendChild(item.content);
      }
      panels.appendChild(panel);
    }

    selectWrap.appendChild(select);
    root.appendChild(selectWrap);
    root.appendChild(tabList);
    root.appendChild(panels);
  }

  function createController(options) {
    const config = options || {};
    const root = resolveElement(config.root || '[data-dvz-setting-sidebar]');
    if (!root) throw new Error('DVZSettingSidebar: root element was not found');

    if (Array.isArray(config.tabs)) renderTabs(root, config.tabs, config.labels);

    root.classList.add('dvz-setting-sidebar');
    root.setAttribute('data-dvz-setting-sidebar-mounted', VERSION);

    const idPrefix = `dvz-setting-sidebar-${++instanceCount}`;
    const tabSelector = config.tabSelector || '[data-dvz-setting-tab], .sidebar-tab';
    const panelSelector = config.panelSelector || '[data-dvz-setting-panel], .sidebar-panel';
    const selectSelector = config.selectSelector || '[data-dvz-setting-tab-select], #sidebar-tab-select';
    const activeClasses = config.activeClassNames || [];
    const inactiveClasses = config.inactiveClassNames || [];
    const hiddenClass = config.hiddenClassName === undefined ? 'hidden' : config.hiddenClassName;
    let activeTabId = null;
    let tabs = [];
    let panels = [];
    let select = null;
    let unbind = [];

    function removeListeners() {
      for (const fn of unbind) fn();
      unbind = [];
    }

    function findPanel(tabId) {
      return panels.find((panel) => panel.id === tabId) || null;
    }

    function activate(tabId, activationOptions) {
      const source = activationOptions?.source || 'api';
      const focus = Boolean(activationOptions?.focus);
      const emit = activationOptions?.emit !== false;
      const requested = String(tabId || '').trim();
      const targetTab = tabs.find((tab) => tabIdOf(tab) === requested) || tabs[0];
      if (!targetTab) return false;
      const nextTabId = tabIdOf(targetTab);
      const targetPanel = findPanel(nextTabId);
      if (!nextTabId || !targetPanel) return false;
      const previousTabId = activeTabId;

      for (const tab of tabs) {
        const active = tab === targetTab;
        tab.classList.toggle('is-active', active);
        for (const name of activeClasses) tab.classList.toggle(name, active);
        for (const name of inactiveClasses) tab.classList.toggle(name, !active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.setAttribute('tabindex', active ? '0' : '-1');
      }

      for (const panel of panels) {
        const active = panel === targetPanel;
        panel.hidden = !active;
        if (hiddenClass) panel.classList.toggle(hiddenClass, !active);
      }

      if (select) select.value = nextTabId;
      activeTabId = nextTabId;
      if (focus && typeof targetTab.focus === 'function') targetTab.focus();

      if (emit && (previousTabId !== nextTabId || source === 'initial')) {
        const detail = { tabId: nextTabId, previousTabId, source };
        dispatchChange(root, detail);
        if (typeof config.onChange === 'function') config.onChange(detail);
      }
      return true;
    }

    function onKeydown(event) {
      const index = tabs.indexOf(event.currentTarget);
      if (index < 0) return;
      let nextIndex = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      activate(tabIdOf(tabs[nextIndex]), { source: 'tab', focus: true });
    }

    function bind() {
      removeListeners();
      tabs = asArray(root.querySelectorAll(tabSelector));
      panels = asArray(root.querySelectorAll(panelSelector));
      select = root.querySelector(selectSelector);
      const tabList = root.querySelector('[data-dvz-setting-tabs]') || tabs[0]?.parentElement;
      if (tabList) {
        tabList.setAttribute('role', 'tablist');
        if (!tabList.getAttribute('aria-label')) tabList.setAttribute('aria-label', config.tabListLabel || 'Settings');
      }

      tabs.forEach((tab, index) => {
        const tabId = tabIdOf(tab);
        const panel = findPanel(tabId);
        if (!tabId || !panel) return;
        if (!tab.id) tab.id = `${idPrefix}-tab-${index + 1}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', tabId);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);

        const click = () => activate(tabId, { source: 'tab', focus: false });
        tab.addEventListener('click', click);
        tab.addEventListener('keydown', onKeydown);
        unbind.push(() => tab.removeEventListener('click', click));
        unbind.push(() => tab.removeEventListener('keydown', onKeydown));
      });

      if (select) {
        const change = () => activate(select.value, { source: 'select', focus: false });
        select.addEventListener('change', change);
        unbind.push(() => select.removeEventListener('change', change));
      }
    }

    function refresh() {
      const previous = activeTabId;
      bind();
      return activate(previous || config.defaultTabId, { source: previous ? 'api' : 'initial', emit: !previous });
    }

    function destroy() {
      removeListeners();
      root.removeAttribute('data-dvz-setting-sidebar-mounted');
    }

    bind();
    activate(config.defaultTabId, { source: 'initial' });

    return {
      activate(tabId) {
        return activate(tabId, { source: 'api' });
      },
      destroy,
      getActiveTabId() {
        return activeTabId;
      },
      refresh,
      root,
      version: VERSION,
    };
  }

  global.DVZSettingSidebar = Object.freeze({
    version: VERSION,
    mount: createController,
  });
})(window);
