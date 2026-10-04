(function (root) {
  'use strict';

  // SVG renderer. Receives a computed scene (projected base coordinates, widths,
  // colours) and draws it. Zoom is semantic: positions go through the zoom
  // transform and flow outlines are rebuilt, so widths stay in screen pixels.

  const G = () => root.FlowGeometry;
  const DURATION = 1000;
  const ZOOM_DURATION = 750;
  const HEAVY_FLOWS = 600;
  const LABEL_FONT = '600 12px "Noto Sans JP", system-ui, sans-serif';
  const LAND = { fill: '#f3f4f6', stroke: '#d1d5db' };

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function measureLabel(text) {
    const ctx = measureLabel.ctx || (measureLabel.ctx = document.createElement('canvas').getContext('2d'));
    ctx.font = LABEL_FONT;
    return { w: ctx.measureText(String(text)).width, h: 14 };
  }

  class FlowRenderer {
    /**
     * opts: { lang, interactive, onNodeClick(id), onZoom(isZoomed), tooltip(event, lines) / hideTooltip() }
     */
    constructor(container, opts = {}) {
      this.container = container;
      this.opts = opts;
      this.transform = d3.zoomIdentity;
      this.scene = null;
      this.hoverId = null;
      this.flowSel = null;
      this.rafPending = false;
      this.heavyBase = null;
      this.uid = `wdfm${Math.random().toString(36).slice(2, 8)}`;
    }

    ensureSvg(width, height) {
      if (this.svg && this.container.contains(this.svg.node())) {
        this.svg.attr('viewBox', `0 0 ${width} ${height}`);
        this.svg.select('rect.wdfm-bg').attr('width', width).attr('height', height);
        this.svg.select(`#${this.uid}-clip rect`).attr('width', width).attr('height', height);
        return;
      }
      this.container.replaceChildren();
      const svg = d3.select(this.container).append('svg')
        .attr('class', 'wdfm-svg')
        .attr('xmlns', 'http://www.w3.org/2000/svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('role', 'img');
      svg.append('title');
      svg.append('desc');
      this.defs = svg.append('defs');
      this.defs.append('clipPath').attr('id', `${this.uid}-clip`).append('rect').attr('width', width).attr('height', height);
      svg.append('rect').attr('class', 'wdfm-bg').attr('width', width).attr('height', height).attr('fill', '#ffffff');
      const plane = svg.append('g').attr('class', 'wdfm-plane').attr('clip-path', `url(#${this.uid}-clip)`);
      this.gBase = plane.append('g').attr('class', 'wdfm-basemap');
      this.gFlows = plane.append('g').attr('class', 'wdfm-flows');
      this.gCenter = plane.append('g').attr('class', 'wdfm-centerlines').style('pointer-events', 'none');
      this.gNodes = plane.append('g').attr('class', 'wdfm-nodes');
      this.gLabels = plane.append('g').attr('class', 'wdfm-labels').style('pointer-events', 'none');
      this.gLegend = svg.append('g').attr('class', 'wdfm-legend').style('pointer-events', 'none');
      this.gMessage = svg.append('g').attr('class', 'wdfm-message').style('pointer-events', 'none');
      this.svg = svg;
      this.setupZoom();
      this.setupPointer();
    }

    setupZoom() {
      const interactive = this.opts.interactive !== false;
      this.zoom = d3.zoom()
        .scaleExtent([1, 16])
        .filter((event) => {
          if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
          if (event.type === 'dblclick') return false;
          if (event.type.startsWith('touch')) return (event.touches?.length || 0) >= 2 || this.transform.k > 1;
          return !event.button;
        })
        .on('start', () => {
          this.svg.selectAll('.wdfm-flow').interrupt();
          this.opts.hideTooltip?.();
        })
        .on('zoom', (event) => {
          this.transform = event.transform;
          this.scheduleFrame(false);
        })
        .on('end', () => {
          this.scheduleFrame(true);
          this.opts.onZoom?.(this.isZoomed());
        });
      if (interactive) {
        this.svg.call(this.zoom).on('dblclick.zoom', null);
        this.svg.style('touch-action', 'pan-x pan-y');
      }
    }

    setupPointer() {
      this.svg.on('pointermove', (event) => this.onPointerMove(event));
      this.svg.on('pointerleave', () => this.setHover(null));
      this.svg.on('click', (event) => {
        const hit = this.hitTest(event);
        if (hit && hit.type === 'node') this.opts.onNodeClick?.(hit.id);
      });
    }

    isZoomed() {
      const t = this.transform;
      return Math.abs(t.k - 1) > 1e-3 || Math.abs(t.x) > 0.5 || Math.abs(t.y) > 0.5;
    }

    // Button zoom eases to the target. Repeated clicks build on the pending target,
    // so three quick clicks still end at 1.5^3.
    animateZoomTo(target) {
      if (!this.svg) return;
      const constrained = this.zoom.constrain()(
        target,
        [[0, 0], [this.scene.width, this.scene.height]],
        this.zoom.translateExtent(),
      );
      if (prefersReducedMotion()) {
        this.svg.call(this.zoom.transform, constrained);
        return;
      }
      this.zoomTarget = constrained;
      // Unnamed on purpose: d3.zoom interrupts the unnamed transition when a drag or pinch starts.
      this.svg.interrupt()
        .transition()
        .duration(ZOOM_DURATION)
        .ease(d3.easeCubicInOut)
        .call(this.zoom.transform, constrained)
        .on('end interrupt', () => {
          if (this.zoomTarget === constrained) this.zoomTarget = null;
        });
    }

    zoomBy(factor) {
      if (!this.svg || !this.scene) return;
      const [k0, k1] = this.zoom.scaleExtent();
      const from = this.zoomTarget || this.transform;
      const center = [this.scene.width / 2, this.scene.height / 2];
      const p = from.invert(center);
      const k = Math.max(k0, Math.min(k1, from.k * factor));
      this.animateZoomTo(d3.zoomIdentity.translate(center[0] - p[0] * k, center[1] - p[1] * k).scale(k));
    }

    resetZoom() {
      if (!this.svg || !this.scene) return;
      this.animateZoomTo(d3.zoomIdentity);
    }

    // Screen position of a node under the current zoom.
    pos(node) {
      return this.transform.apply([node.x, node.y]);
    }

    flowParams(flow) {
      const a = this.scene.nodeById.get(flow.from);
      const b = this.scene.nodeById.get(flow.to);
      return {
        ...flow.params,
        p0: this.pos(a),
        p1: this.pos(b),
        rStart: a.r,
        rEnd: b.r,
      };
    }

    outline(params, density) {
      return G().flowOutline({ ...params, density });
    }

    /**
     * scene: { width, height, title, desc, basemap, nodes, flows, labels, legend, message }
     */
    render(scene, { animate = false } = {}) {
      const prevScene = this.scene;
      this.scene = { ...scene, nodeById: new Map(scene.nodes.map((n) => [n.id, n])) };
      this.ensureSvg(scene.width, scene.height);
      const resized = prevScene && (prevScene.width !== scene.width || prevScene.height !== scene.height);
      if (!prevScene || resized || scene.resetZoom) {
        this.zoom.translateExtent([[-scene.width * 0.2, -scene.height * 0.2], [scene.width * 1.2, scene.height * 1.2]]);
        this.zoom.extent([[0, 0], [scene.width, scene.height]]);
        let next = d3.zoomIdentity;
        if (resized && !scene.resetZoom && this.isZoomed()) {
          // Keep the zoom across resizes; the projection is refit, so scale the offset.
          const t = this.transform;
          next = d3.zoomIdentity.translate(t.x * (scene.width / prevScene.width), t.y * (scene.height / prevScene.height)).scale(t.k);
        }
        this.transform = next;
        this.svg.property('__zoom', next);
      }
      this.svg.select('title').text(scene.title || '');
      this.svg.select('desc').text(scene.desc || '');
      const doAnimate = animate && !prefersReducedMotion() && !!prevScene;
      this.drawBasemap();
      this.drawFlows(doAnimate);
      this.drawNodes(doAnimate);
      this.legendBox = root.FlowLegend.draw(this.gLegend, this.defs, scene.legend, scene);
      this.drawLabels();
      this.drawMessage();
      this.heavyBase = null;
      this.buildHitIndex();
    }

    drawBasemap() {
      const g = this.gBase;
      g.selectAll('*').remove();
      const bm = this.scene.basemap;
      g.attr('transform', this.transform.toString()).attr('data-export-k', this.transform.k);
      if (!bm) return;
      const stroke = (sel, color, width) => sel.attr('stroke', color).attr('stroke-width', width).attr('vector-effect', 'non-scaling-stroke');
      if (bm.sphere) {
        stroke(g.append('path').attr('d', bm.path({ type: 'Sphere' })).attr('fill', '#fbfcfd'), '#e5e7eb', 0.75);
      }
      g.append('path')
        .attr('class', 'wdfm-land')
        .attr('d', bm.path({ type: 'FeatureCollection', features: bm.features }))
        .attr('fill', LAND.fill)
        .call(stroke, LAND.stroke, 0.5);
      if (bm.borders) {
        g.append('path').attr('class', 'wdfm-borders').attr('d', bm.path(bm.borders)).attr('fill', 'none').call(stroke, LAND.stroke, 0.5);
      }
      if (bm.insetFrame && bm.insetPath && bm.insetFeatures) {
        const f = bm.insetFrame;
        g.append('rect').attr('class', 'wdfm-inset-frame').attr('x', f.x).attr('y', f.y).attr('width', f.w).attr('height', f.h)
          .attr('fill', '#ffffff').call(stroke, '#9ca3af', 0.75);
        g.append('path').attr('class', 'wdfm-inset-land')
          .attr('d', bm.insetPath({ type: 'FeatureCollection', features: bm.insetFeatures }))
          .attr('fill', LAND.fill).call(stroke, LAND.stroke, 0.5);
      }
    }

    drawFlows(animate) {
      const flows = this.scene.flows;
      const sel = this.gFlows.selectAll('path.wdfm-flow').data(flows, (d) => d.id);
      const self = this;
      const center = this.gCenter;
      center.selectAll('*').remove();

      sel.exit().each(function exitFlow(d) {
        const el = d3.select(this);
        if (!animate || !this.__params) { el.remove(); return; }
        const from = this.__params;
        const to = { ...from, width: 0 };
        el.classed('wdfm-exiting', true).transition().duration(DURATION).ease(d3.easeCubicInOut)
          .attrTween('d', () => (t) => self.outline(G().lerpParams(from, to, t)).d || '')
          .style('opacity', 0)
          .remove();
      });

      const enter = sel.enter().append('path').attr('class', 'wdfm-flow');
      const merged = enter.merge(sel)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 0.75)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke');
      // Larger flows first so small flows stay visible on top.
      merged.order();

      merged.each(function updateFlow(d) {
        const el = d3.select(this);
        const to = self.flowParams(d);
        const isNew = !this.__params;
        const from = isNew ? { ...to, width: 0 } : this.__params;
        this.__params = to;
        el.attr('fill', d.color).attr('fill-opacity', d.opacity);
        if (animate) {
          el.interrupt().transition().duration(DURATION).ease(d3.easeCubicInOut)
            .attrTween('d', () => (t) => self.outline(G().lerpParams(from, to, t)).d || '');
        } else {
          el.interrupt().attr('d', self.outline(to).d || '');
        }
      });
      this.flowSel = merged;
      this.drawCenterlines();
      this.applyHover();
    }

    drawCenterlines() {
      const g = this.gCenter;
      g.selectAll('*').remove();
      if (!this.scene.flows.some((f) => f.params.centerline > 0)) return;
      this.scene.flows.forEach((f) => {
        if (!(f.params.centerline > 0)) return;
        const o = this.outline(this.flowParams(f));
        if (o.status !== 'ok' || !o.centerD) return;
        g.append('path').attr('d', o.centerD).attr('fill', 'none').attr('stroke', '#1f2937').attr('stroke-width', 1.25).attr('stroke-linecap', 'round');
        g.append('path').attr('d', o.arrowD).attr('fill', '#1f2937');
      });
    }

    drawNodes(animate) {
      const self = this;
      const sel = this.gNodes.selectAll('circle.wdfm-node').data(this.scene.nodes, (d) => d.id);
      sel.exit().remove();
      const merged = sel.enter().append('circle').attr('class', 'wdfm-node').attr('r', 0)
        .merge(sel)
        .attr('stroke', '#1f2937')
        .attr('stroke-width', 0.75)
        .attr('fill', (d) => d.fill)
        .style('cursor', this.opts.onNodeClick ? 'pointer' : null);
      merged.each(function placeNode(d) {
        const [x, y] = self.pos(d);
        const el = d3.select(this);
        if (animate) el.transition().duration(DURATION).ease(d3.easeCubicInOut).attr('cx', x).attr('cy', y).attr('r', d.r);
        else el.attr('cx', x).attr('cy', y).attr('r', d.r);
      });
      merged.classed('is-focus', (d) => d.focus);
    }

    drawLabels() {
      const g = this.gLabels;
      g.selectAll('*').remove();
      const ids = this.scene.labels || [];
      if (!ids.length) return;
      const items = ids.map((id, i) => {
        const n = this.scene.nodeById.get(id);
        if (!n) return null;
        const [x, y] = this.pos(n);
        return { id, x, y, r: n.r, text: n.label, priority: ids.length - i };
      }).filter(Boolean);
      const obstacles = this.legendBox ? [this.legendBox] : [];
      const placed = G().placeLabels(items, measureLabel, [2, 2, this.scene.width - 2, this.scene.height - 2], obstacles);
      placed.forEach((d) => {
        const [nx, ny] = this.pos(this.scene.nodeById.get(d.id));
        d.dx = d.x - nx;
        d.dy = d.y - ny;
      });
      const texts = g.selectAll('text').data(placed).enter().append('text')
        .attr('x', (d) => d.x)
        .attr('y', (d) => d.y)
        .attr('text-anchor', (d) => d.anchor)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 12)
        .attr('font-weight', 600)
        .style('font-family', '"Noto Sans JP", system-ui, sans-serif')
        .text((d) => d.text);
      root.FlowMapHelpers.applyLabelStroke(texts);
    }

    drawMessage() {
      const g = this.gMessage;
      g.selectAll('*').remove();
      const msg = this.scene.message;
      if (!msg) return;
      const w = this.scene.width;
      const lines = String(msg).split('\n');
      lines.forEach((line, i) => {
        g.append('text')
          .attr('x', w / 2)
          .attr('y', 28 + i * 18)
          .attr('text-anchor', 'middle')
          .attr('font-size', 13)
          .attr('fill', '#4b5563')
          .style('font-family', '"Noto Sans JP", system-ui, sans-serif')
          .attr('data-export-remove', '')
          .text(line);
      });
    }

    scheduleFrame(settled) {
      this.settledPending = this.settledPending || settled;
      if (this.rafPending) return;
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        const full = this.settledPending;
        this.settledPending = false;
        this.redrawForZoom(full);
      });
    }

    // Zoom frame: move the basemap by transform, rebuild flows (or transform them when heavy).
    redrawForZoom(settled) {
      if (!this.scene || !this.svg) return;
      const t = this.transform;
      this.gBase.attr('transform', t.toString()).attr('data-export-k', t.k);
      const heavy = this.scene.flows.length > HEAVY_FLOWS;
      if (heavy && !settled) {
        if (!this.heavyBase) this.heavyBase = this.lastFullTransform || d3.zoomIdentity;
        const b = this.heavyBase;
        const k = t.k / b.k;
        this.gFlows.attr('transform', `translate(${t.x - b.x * k},${t.y - b.y * k}) scale(${k})`);
        this.gCenter.attr('transform', this.gFlows.attr('transform'));
      } else {
        this.gFlows.attr('transform', null);
        this.gCenter.attr('transform', null);
        this.heavyBase = null;
        const self = this;
        const [vx0, vy0, vx1, vy1] = [-40, -40, this.scene.width + 40, this.scene.height + 40];
        this.flowSel?.each(function zoomFlow(d) {
          const params = self.flowParams(d);
          this.__params = params;
          const [x0, y0] = params.p0;
          const [x1, y1] = params.p1;
          const offscreen = Math.max(x0, x1) < vx0 || Math.min(x0, x1) > vx1 || Math.max(y0, y1) < vy0 || Math.min(y0, y1) > vy1;
          if (offscreen && !settled) return;
          d3.select(this).attr('d', self.outline(params, settled ? 1 : 0.5).d || '');
        });
        this.drawCenterlines();
        this.lastFullTransform = t;
      }
      this.gNodes.selectAll('circle.wdfm-node').each(function zoomNode(d) {
        const [x, y] = t.apply([d.x, d.y]);
        d3.select(this).attr('cx', x).attr('cy', y);
      });
      if (settled) {
        this.drawLabels();
        this.buildHitIndex();
      } else {
        // Labels ride along with their nodes; placement is redone when the zoom settles.
        const nodeById = this.scene.nodeById;
        this.gLabels.selectAll('text').each(function moveLabel(d) {
          const n = nodeById.get(d.id);
          if (!n) return;
          const [x, y] = t.apply([n.x, n.y]);
          d3.select(this).attr('x', x + d.dx).attr('y', y + d.dy);
        });
      }
    }

    buildHitIndex() {
      const points = [];
      (this.scene?.flows || []).forEach((f) => {
        const o = this.outline(this.flowParams(f), 1);
        if (o.status !== 'ok') return;
        o.samples.forEach((s) => points.push({ x: s.x, y: s.y, hw: s.hw, id: f.id }));
      });
      this.hitTree = d3.quadtree().x((d) => d.x).y((d) => d.y).addAll(points);
    }

    // Client coordinates -> SVG user coordinates.
    toLocal(event) {
      const node = this.svg.node();
      const pt = node.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const m = node.getScreenCTM();
      if (!m) return [0, 0];
      const p = pt.matrixTransform(m.inverse());
      return [p.x, p.y];
    }

    hitTest(event) {
      if (!this.scene) return null;
      const [x, y] = this.toLocal(event);
      let bestNode = null;
      this.scene.nodes.forEach((n) => {
        const [nx, ny] = this.pos(n);
        const d = Math.hypot(nx - x, ny - y);
        if (d <= Math.max(n.r + 3, 7) && (!bestNode || d < bestNode.d)) bestNode = { id: n.id, d };
      });
      if (bestNode) return { type: 'node', id: bestNode.id };
      if (!this.hitTree) return null;
      let best = null;
      const radius = 30;
      this.hitTree.visit((quad, x0, y0, x1, y1) => {
        if (!quad.length) {
          let q = quad;
          do {
            const d = q.data;
            const score = Math.hypot(d.x - x, d.y - y) - d.hw;
            if (score <= Math.max(6, d.hw) && (!best || score < best.score)) best = { id: d.id, score };
            q = q.next;
          } while (q);
        }
        return x0 > x + radius || x1 < x - radius || y0 > y + radius || y1 < y - radius;
      });
      return best ? { type: 'flow', id: best.id } : null;
    }

    onPointerMove(event) {
      const hit = this.hitTest(event);
      if (!hit) {
        this.setHover(null);
        this.opts.hideTooltip?.();
        this.svg.style('cursor', null);
        return;
      }
      this.svg.style('cursor', hit.type === 'node' && this.opts.onNodeClick ? 'pointer' : null);
      this.setHover(hit.type === 'flow' ? hit.id : null);
      this.opts.tooltip?.(event, hit);
    }

    setHover(id) {
      if (this.hoverId === id) return;
      this.hoverId = id;
      this.applyHover();
    }

    applyHover() {
      if (!this.flowSel) return;
      const id = this.hoverId;
      if (!id) {
        this.flowSel.attr('fill-opacity', (d) => d.opacity);
        return;
      }
      const hovered = this.scene.flows.find((f) => f.id === id);
      const partner = hovered ? `${hovered.to}→${hovered.from}` : null;
      this.flowSel.attr('fill-opacity', (d) => (d.id === id || d.id === partner ? Math.max(0.95, d.opacity) : d.opacity * 0.25));
    }

    destroy() {
      this.svg?.remove();
      this.svg = null;
    }
  }

  root.FlowRenderer = FlowRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
