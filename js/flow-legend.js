(function (root) {
  'use strict';

  // Legend drawn inside the SVG so it reaches SVG/PNG export and thumbnails.
  // spec: { position, title, widths: [{label, width}], shape, color, node }

  const PAD = 10;
  const ROW = 18;
  const FONT = '11px "Noto Sans JP", system-ui, sans-serif';

  function textWidth(text) {
    const ctx = textWidth.ctx || (textWidth.ctx = document.createElement('canvas').getContext('2d'));
    ctx.font = FONT;
    return ctx.measureText(String(text)).width;
  }

  function addText(g, x, y, text, opts = {}) {
    return g.append('text')
      .attr('x', x)
      .attr('y', y)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', opts.anchor || 'start')
      .attr('font-size', opts.size || 11)
      .attr('font-weight', opts.weight || 400)
      .attr('fill', opts.fill || '#374151')
      .style('font-family', '"Noto Sans JP", system-ui, sans-serif')
      .text(text);
  }

  function gradientId(name) {
    return `wdfm-legend-${name}`;
  }

  function addGradient(defs, name, stops) {
    defs.select(`#${gradientId(name)}`).remove();
    const grad = defs.append('linearGradient').attr('id', gradientId(name)).attr('x1', 0).attr('x2', 1);
    stops.forEach((color, i) => {
      grad.append('stop').attr('offset', `${(i / (stops.length - 1)) * 100}%`).attr('stop-color', color);
    });
    return `url(#${gradientId(name)})`;
  }

  /**
   * Draws the legend into `layer` (a <g>). Returns the bounding box [x0, y0, x1, y1] or null.
   */
  function draw(layer, defs, spec, size) {
    layer.selectAll('*').remove();
    if (!spec || spec.position === 'none') return null;
    const G = root.FlowGeometry;
    const body = layer.append('g').attr('class', 'wdfm-legend-body');
    let y = 0;
    let maxW = 0;

    if (spec.widths && spec.widths.length) {
      if (spec.title) {
        addText(body, 0, y + 6, spec.title, { weight: 700, fill: '#111827' });
        maxW = Math.max(maxW, textWidth(spec.title));
        y += ROW;
      }
      if (spec.note) {
        addText(body, 0, y + 5, spec.note, { size: 10, fill: '#6b7280' });
        maxW = Math.max(maxW, textWidth(spec.note) * (10 / 11));
        y += ROW - 2;
      }
      const sampleLen = 54;
      spec.widths.forEach((item) => {
        const h = Math.max(ROW, item.width + 6);
        const cy = y + h / 2;
        const outline = G.flowOutline({
          p0: [0, cy],
          p1: [sampleLen, cy],
          width: item.width,
          curvature: 0,
          offset: 0,
          rStart: 0,
          rEnd: 0,
          gap: 0,
          ...G.shapeParams(spec.shape),
        });
        if (outline.status === 'ok') {
          body.append('path').attr('d', outline.d).attr('fill', spec.sampleColor || '#2563eb').attr('fill-opacity', 0.85);
          if (outline.centerD) {
            body.append('path').attr('d', outline.centerD).attr('fill', 'none').attr('stroke', '#1f2937').attr('stroke-width', 1.25);
            body.append('path').attr('d', outline.arrowD).attr('fill', '#1f2937');
          }
        }
        addText(body, sampleLen + 8, cy, item.label);
        maxW = Math.max(maxW, sampleLen + 8 + textWidth(item.label));
        y += h;
      });
    }

    const color = spec.color;
    if (color && color.type === 'swatches' && color.items.length) {
      y += 4;
      if (color.title) {
        addText(body, 0, y + 6, color.title, { weight: 700, fill: '#111827' });
        maxW = Math.max(maxW, textWidth(color.title));
        y += ROW;
      }
      color.items.forEach((item) => {
        body.append('rect').attr('x', 0).attr('y', y + 3).attr('width', 12).attr('height', 12).attr('rx', 2).attr('fill', item.color);
        addText(body, 18, y + 9, item.label);
        maxW = Math.max(maxW, 18 + textWidth(item.label));
        y += ROW;
      });
    }
    const gradients = [color && color.type === 'gradient' ? color : null, spec.node].filter(Boolean);
    gradients.forEach((grad, i) => {
      y += 4;
      if (grad.title) {
        addText(body, 0, y + 6, grad.title, { weight: 700, fill: '#111827' });
        maxW = Math.max(maxW, textWidth(grad.title));
        y += ROW;
      }
      const barW = 120;
      body.append('rect').attr('x', 0).attr('y', y).attr('width', barW).attr('height', 8).attr('rx', 2)
        .attr('fill', addGradient(defs, `g${i}`, grad.stops));
      y += 14;
      addText(body, 0, y + 4, grad.left, { size: 10, fill: '#6b7280' });
      addText(body, barW, y + 4, grad.right, { size: 10, fill: '#6b7280', anchor: 'end' });
      maxW = Math.max(maxW, barW, textWidth(grad.left) + textWidth(grad.right) + 8);
      y += ROW - 4;
    });

    if (y === 0) {
      layer.selectAll('*').remove();
      return null;
    }
    const w = maxW + PAD * 2;
    const h = y + PAD * 2 - 4;
    const margin = 12;
    const pos = spec.position || 'bottom-right';
    const x0 = pos.endsWith('left') ? margin : size.width - w - margin;
    const y0 = pos.startsWith('top') ? margin : size.height - h - margin;
    layer.insert('rect', ':first-child')
      .attr('x', x0)
      .attr('y', y0)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 6)
      .attr('fill', '#ffffff')
      .attr('fill-opacity', 0.88)
      .attr('stroke', '#e5e7eb');
    body.attr('transform', `translate(${x0 + PAD},${y0 + PAD})`);
    return [x0, y0, x0 + w, y0 + h];
  }

  root.FlowLegend = { draw, textWidth };
})(typeof window !== 'undefined' ? window : globalThis);
