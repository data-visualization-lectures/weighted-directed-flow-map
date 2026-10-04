(function (root) {
  'use strict';

  // Viewer controls in #dvz-controls (same markup in the editor and share.html).
  // Options and labels are built with textContent because place names come from data.

  const TEXT = {
    ja: {
      place: '地点', all: 'すべて', direction: '方向', both: '両方', out: '流出', in: '流入',
      mode: '表示', gross: '総量', net: '純量', allGroups: 'すべて合計', zoomIn: '拡大', zoomOut: '縮小', reset: 'リセット',
    },
    en: {
      place: 'Place', all: 'All', direction: 'Direction', both: 'Both', out: 'Out', in: 'In',
      mode: 'View', gross: 'Gross', net: 'Net', allGroups: 'All (sum)', zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset',
    },
  };

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'className') node.className = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    if (text != null) node.textContent = text;
    return node;
  }

  function option(value, label) {
    const o = el('option', { value }, label);
    return o;
  }

  function control(labelText, select) {
    const label = el('label', { className: 'dvz-control' });
    label.appendChild(el('span', { className: 'dvz-control-label' }, labelText));
    label.appendChild(select);
    return label;
  }

  class FlowControls {
    /**
     * handlers: { onChange(key, value), onZoomIn(), onZoomOut(), onReset() }
     */
    constructor(container, { lang = 'ja', handlers = {} } = {}) {
      this.container = container;
      this.lang = lang === 'en' ? 'en' : 'ja';
      this.handlers = handlers;
      this.built = false;
    }

    build() {
      const tx = TEXT[this.lang];
      const row = el('div', { className: 'dvz-controls-row' });
      this.focus = el('select', { className: 'dvz-control-select', id: 'ctl-focus' });
      this.direction = el('select', { className: 'dvz-control-select', id: 'ctl-direction' });
      ['both', 'out', 'in'].forEach((v) => this.direction.appendChild(option(v, tx[v])));
      this.mode = el('select', { className: 'dvz-control-select', id: 'ctl-mode' });
      ['gross', 'net'].forEach((v) => this.mode.appendChild(option(v, tx[v])));
      this.group = el('select', { className: 'dvz-control-select', id: 'ctl-group' });
      this.groupWrap = control('', this.group);
      this.groupLabel = this.groupWrap.querySelector('.dvz-control-label');
      row.appendChild(control(tx.place, this.focus));
      row.appendChild(control(tx.direction, this.direction));
      row.appendChild(control(tx.mode, this.mode));
      row.appendChild(this.groupWrap);
      this.zoomIn = el('button', { type: 'button', className: 'dvz-control-btn dvz-control-btn--icon', 'aria-label': tx.zoomIn, title: tx.zoomIn }, '＋');
      this.zoomOut = el('button', { type: 'button', className: 'dvz-control-btn dvz-control-btn--icon', 'aria-label': tx.zoomOut, title: tx.zoomOut }, '−');
      this.reset = el('button', { type: 'button', className: 'dvz-control-btn', id: 'ctl-reset' }, tx.reset);
      this.reset.style.visibility = 'hidden';
      row.appendChild(this.zoomIn);
      row.appendChild(this.zoomOut);
      row.appendChild(this.reset);
      this.container.replaceChildren(row);

      this.focus.addEventListener('change', () => this.handlers.onChange?.('focusNode', this.focus.value || null));
      this.direction.addEventListener('change', () => this.handlers.onChange?.('focusDirection', this.direction.value));
      this.mode.addEventListener('change', () => this.handlers.onChange?.('flowMode', this.mode.value));
      this.group.addEventListener('change', () => this.handlers.onChange?.('groupValue', this.group.value));
      this.zoomIn.addEventListener('click', () => this.handlers.onZoomIn?.());
      this.zoomOut.addEventListener('click', () => this.handlers.onZoomOut?.());
      this.reset.addEventListener('click', () => this.handlers.onReset?.());
      this.built = true;
    }

    /**
     * state: { nodes: [{id, label}], groups: [], groupLabel, focusNode, focusDirection, flowMode, group }
     */
    update(state) {
      if (!this.built) this.build();
      const tx = TEXT[this.lang];
      const nodesKey = state.nodes.map((n) => `${n.id}:${n.label}`).join('|');
      if (nodesKey !== this.nodesKey) {
        this.nodesKey = nodesKey;
        this.focus.replaceChildren(option('', tx.all), ...state.nodes.map((n) => option(n.id, n.label)));
      }
      this.focus.value = state.focusNode || '';
      this.direction.value = state.focusDirection || 'both';
      this.direction.disabled = !state.focusNode;
      this.mode.value = state.flowMode || 'gross';

      const groups = state.groups || [];
      const hasGroups = groups.length > 1;
      this.groupWrap.hidden = !hasGroups;
      if (hasGroups) {
        const groupsKey = groups.join('|');
        if (groupsKey !== this.groupsKey) {
          this.groupsKey = groupsKey;
          this.group.replaceChildren(...groups.map((g) => option(g, g)), option('__all__', tx.allGroups));
        }
        this.groupLabel.textContent = state.groupLabel || '';
        this.group.value = state.group;
      }
      this.container.hidden = false;
    }

    setResetVisible(visible) {
      if (this.reset) this.reset.style.visibility = visible ? 'visible' : 'hidden';
    }

    clear() {
      this.container.replaceChildren();
      this.built = false;
      this.nodesKey = null;
      this.groupsKey = null;
    }
  }

  root.FlowControls = FlowControls;
})(typeof window !== 'undefined' ? window : globalThis);
