(function (root) {
  'use strict';

  // Basemap topology loading and projections. Needs d3 and topojson-client in the
  // browser; the island classification helpers are pure and run in node tests.

  const JAPAN_BOX = { lonMin: 122, lonMax: 154, latMin: 20, latMax: 46 };
  const ANTARCTICA_ID = '010';
  const cache = new Map();

  // Islands south of Kyushu (Tokara, Amami, Okinawa) move to the top-left inset.
  // Yakushima / Tanegashima (30.3-30.8N) stay with Kyushu.
  function isSouthWestPoint(lon, lat) {
    return lat < 30 && lon > 122 && lon < 132;
  }

  // Far islands that should not drive the extent: Izu south of Miyake (Hachijo),
  // Ogasawara, Minamitorishima, Okinotorishima. They are still drawn.
  function isRemotePoint(lon, lat) {
    if (isSouthWestPoint(lon, lat)) return false;
    return (lat < 33.6 && lon > 138.5) || lat < 24.5;
  }

  // Planar mean of the outer ring: good enough to place an island.
  function ringCenter(polygon) {
    const ring = polygon[0] || [];
    let x = 0;
    let y = 0;
    ring.forEach(([lon, lat]) => { x += lon; y += lat; });
    return ring.length ? [x / ring.length, y / ring.length] : [NaN, NaN];
  }

  function polygonsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }

  function featureFrom(feature, polygons) {
    if (!polygons.length) return null;
    return {
      type: 'Feature',
      id: feature.id,
      properties: feature.properties,
      geometry: polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
    };
  }

  /**
   * Splits every prefecture into main / south-west inset / remote pieces by island position.
   * Returns { main, inset, fit, fitWithInset } as feature arrays.
   *   main: everything except the south-west islands (drawn on the main map when the inset is on)
   *   inset: the south-west islands (drawn inside the inset frame)
   *   fit: main pieces without remote islands (used to fit the extent when the inset is on)
   *   fitWithInset: fit + south-west islands (used to fit the extent when the inset is off)
   */
  function splitJapan(features) {
    const main = [];
    const inset = [];
    const fit = [];
    const fitWithInset = [];
    features.forEach((f) => {
      const mainPolys = [];
      const insetPolys = [];
      const fitPolys = [];
      polygonsOf(f.geometry).forEach((poly) => {
        const [lon, lat] = ringCenter(poly);
        if (isSouthWestPoint(lon, lat)) {
          insetPolys.push(poly);
          return;
        }
        mainPolys.push(poly);
        if (!isRemotePoint(lon, lat)) fitPolys.push(poly);
      });
      const m = featureFrom(f, mainPolys);
      const i = featureFrom(f, insetPolys);
      const ft = featureFrom(f, fitPolys);
      const fi = featureFrom(f, [...fitPolys, ...insetPolys]);
      if (m) main.push(m);
      if (i) inset.push(i);
      if (ft) fit.push(ft);
      if (fi) fitWithInset.push(fi);
    });
    return { main, inset, fit, fitWithInset };
  }

  function loadTopology(kind, base = 'data/basemap/') {
    if (kind !== 'world' && kind !== 'japan') return Promise.resolve(null);
    const key = `${base}${kind}`;
    if (!cache.has(key)) {
      const file = kind === 'world' ? 'countries-110m.json' : 'japan.topojson';
      cache.set(key, fetch(`${base}${file}`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} ${file}`);
          return res.json();
        })
        .then((topo) => {
          const object = kind === 'world' ? topo.objects.countries : topo.objects.japan;
          const collection = root.topojson.feature(topo, object);
          const borders = root.topojson.mesh(topo, object, (a, b) => a !== b);
          if (kind === 'japan') {
            return { kind, features: collection.features, borders, japan: splitJapan(collection.features) };
          }
          const mainland = collection.features.filter((f) => f.id !== ANTARCTICA_ID);
          return { kind, features: collection.features, mainland, borders };
        })
        .catch((error) => {
          cache.delete(key);
          throw error;
        }));
    }
    return cache.get(key);
  }

  function inJapanBox(node) {
    return node.lon >= JAPAN_BOX.lonMin && node.lon <= JAPAN_BOX.lonMax
      && node.lat >= JAPAN_BOX.latMin && node.lat <= JAPAN_BOX.latMax;
  }

  // auto: Japan when every place sits in the Japan box, otherwise world.
  function resolveBasemapKind(setting, nodes) {
    if (setting === 'world' || setting === 'japan' || setting === 'none') return setting;
    const list = (nodes || []).filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lon));
    if (!list.length) return 'world';
    return list.every(inJapanBox) ? 'japan' : 'world';
  }

  function resolveProjectionKind(setting, basemapKind) {
    if (setting && setting !== 'auto') return setting;
    return basemapKind === 'japan' ? 'mercator' : 'natural-earth';
  }

  function makeProjection(kind) {
    switch (kind) {
      case 'equal-earth': return d3.geoEqualEarth();
      case 'mercator': return d3.geoMercator();
      case 'conic-conformal': return d3.geoConicConformal().parallels([30, 45]);
      default: return d3.geoNaturalEarth1();
    }
  }

  function isInsetNode(node) {
    return Number.isFinite(node.lon) && Number.isFinite(node.lat) && isSouthWestPoint(node.lon, node.lat);
  }

  function validNodes(nodes) {
    return nodes.filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lon));
  }

  // GeoJSON that covers the nodes, padded to a minimum span so 1-2 places still fit.
  function nodesExtentGeo(nodes, minSpan, center) {
    const list = validNodes(nodes);
    if (!list.length) return null;
    const wrap = (lon) => ((((lon - center + 180) % 360) + 360) % 360) - 180 + center;
    const lons = list.map((n) => wrap(n.lon));
    const lats = list.map((n) => n.lat);
    let [lo0, lo1] = d3.extent(lons);
    let [la0, la1] = d3.extent(lats);
    if (lo1 - lo0 < minSpan) {
      const c = (lo0 + lo1) / 2;
      lo0 = c - minSpan / 2;
      lo1 = c + minSpan / 2;
    }
    if (la1 - la0 < minSpan * 0.6) {
      const c = (la0 + la1) / 2;
      la0 = c - minSpan * 0.3;
      la1 = c + minSpan * 0.3;
    }
    la0 = Math.max(-85, la0);
    la1 = Math.min(85, la1);
    return { type: 'MultiPoint', coordinates: [[lo0, la0], [lo1, la0], [lo1, la1], [lo0, la1], ...list.map((n, i) => [lons[i], n.lat])] };
  }

  // Japan "fit to places": the land of every prefecture that holds a place, plus the places.
  function japanNodesTarget(nodes, pieces) {
    const list = validNodes(nodes);
    if (!list.length) return null;
    const byId = new Map(pieces.map((f) => [Number(f.properties.id), f]));
    const chosen = new Set();
    list.forEach((n) => {
      if (n.kind === 'jp-prefectures' && byId.has(Number(n.code))) {
        chosen.add(byId.get(Number(n.code)));
        return;
      }
      const hit = pieces.find((f) => d3.geoContains(f, [n.lon, n.lat]));
      if (hit) chosen.add(hit);
    });
    const features = [...chosen];
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: list.map((n) => [n.lon, n.lat]) } });
    return { type: 'FeatureCollection', features };
  }

  function boxesOverlap(a, b) {
    return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  }

  /**
   * Inset for the south-west islands: as large as the empty top-left corner allows,
   * never at a larger scale than the main map.
   */
  function buildInset({ projKind, center, main, content, obstacles, width, height, pad = 12 }) {
    const inner = 8;
    const probe = makeProjection(projKind).rotate([-center, 0]).scale(main.scale()).translate([0, 0]);
    const [[cx0, cy0], [cx1, cy1]] = d3.geoPath(probe).bounds(content);
    const cw = Math.max(1, cx1 - cx0);
    const ch = Math.max(1, cy1 - cy0);
    const maxW = width * 0.45;
    const maxH = height * 0.45;
    let s = Math.min(1, (maxW - inner * 2) / cw, (maxH - inner * 2) / ch);
    let frame = null;
    for (let i = 0; i < 40 && s > 0.05; i += 1) {
      const candidate = { x: pad, y: pad, w: cw * s + inner * 2, h: ch * s + inner * 2 };
      const box = [candidate.x, candidate.y, candidate.x + candidate.w, candidate.y + candidate.h];
      frame = candidate;
      if (!obstacles.some((o) => boxesOverlap(box, o))) break;
      s *= 0.92;
    }
    const inset = makeProjection(projKind).rotate([-center, 0]).scale(main.scale() * s).translate([0, 0]);
    const [[bx0, by0]] = d3.geoPath(inset).bounds(content);
    inset.translate([frame.x + inner - bx0, frame.y + inner - by0]);
    return { inset, frame, scaleRatio: s };
  }

  /**
   * Builds the projection for the current size and settings.
   * Returns { kind, project(node) -> [x, y] | null, path, insetPath, insetFrame, insetFeatures, mainFeatures, center, isInset(node) }.
   */
  function createProjection({ basemapKind, projection, centerLongitude, size, nodes, geo, extent, okinawaInset, pad = 28 }) {
    const width = Math.max(10, size.width);
    const height = Math.max(10, size.height);
    const projKind = resolveProjectionKind(projection, basemapKind);
    const main = makeProjection(projKind);
    const isJapan = basemapKind === 'japan';
    const center = isJapan ? 137 : (Number.isFinite(centerLongitude) ? centerLongitude : 0);
    main.rotate([-center, 0]);
    const jp = isJapan && geo ? geo.japan : null;
    const useInset = !!(jp && okinawaInset && jp.inset.length);
    const insetNodes = useInset ? nodes.filter(isInsetNode) : [];
    const insetIds = new Set(insetNodes.map((n) => n.id));
    const mainNodes = useInset ? nodes.filter((n) => !insetIds.has(n.id)) : nodes;

    let target = null;
    if (jp) {
      const pieces = useInset ? jp.fit : jp.fitWithInset;
      target = extent === 'basemap'
        ? { type: 'FeatureCollection', features: pieces }
        : (japanNodesTarget(mainNodes, pieces) || { type: 'FeatureCollection', features: pieces });
    } else if (extent === 'basemap' && geo) {
      target = projKind === 'mercator' ? { type: 'FeatureCollection', features: geo.mainland } : { type: 'Sphere' };
    } else {
      target = nodesExtentGeo(mainNodes, isJapan ? 1.5 : 15, center);
      if (!target) target = isJapan ? nodesExtentGeo([{ lon: 137, lat: 36 }], 12, center) : { type: 'Sphere' };
    }
    if (projKind === 'mercator' && target.type === 'Sphere') {
      target = nodesExtentGeo([{ lon: center - 179, lat: -60 }, { lon: center + 179, lat: 75 }], 0, center);
    }
    main.fitExtent([[pad, pad], [width - pad, height - pad]], target);

    let inset = null;
    let insetFrame = null;
    if (useInset) {
      const mainPath = d3.geoPath(main);
      const obstacles = [];
      jp.main.forEach((f) => {
        polygonsOf(f.geometry).forEach((poly) => {
          const [[x0, y0], [x1, y1]] = mainPath.bounds({ type: 'Polygon', coordinates: poly });
          if ((x1 - x0) * (y1 - y0) >= 4) obstacles.push([x0 - 4, y0 - 4, x1 + 4, y1 + 4]);
        });
      });
      mainNodes.forEach((n) => {
        const p = main([n.lon, n.lat]);
        if (p) obstacles.push([p[0] - 8, p[1] - 8, p[0] + 8, p[1] + 8]);
      });
      const content = { type: 'FeatureCollection', features: [...jp.inset] };
      if (insetNodes.length) {
        content.features.push({ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: insetNodes.map((n) => [n.lon, n.lat]) } });
      }
      const built = buildInset({ projKind, center, main, content, obstacles, width, height });
      inset = built.inset;
      insetFrame = built.frame;
    }

    const isInset = (node) => !!inset && insetIds.has(node.id);
    const project = (node) => {
      if (!Number.isFinite(node.lon) || !Number.isFinite(node.lat)) return null;
      const p = (isInset(node) ? inset : main)([node.lon, node.lat]);
      return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
    };
    let mainFeatures = null;
    if (jp) mainFeatures = useInset ? jp.main : geo.features;
    else if (geo) mainFeatures = geo.mainland;
    return {
      kind: basemapKind,
      projection: projKind,
      center,
      width,
      height,
      project,
      isInset,
      path: d3.geoPath(main),
      insetPath: inset ? d3.geoPath(inset) : null,
      insetFrame,
      insetFeatures: useInset ? jp.inset : null,
      mainFeatures,
      sphere: projKind !== 'mercator' && !isJapan,
    };
  }

  root.FlowBasemap = {
    JAPAN_BOX,
    loadTopology,
    resolveBasemapKind,
    resolveProjectionKind,
    createProjection,
    splitJapan,
    isSouthWestPoint,
    isRemotePoint,
    isInsetNode,
    inJapanBox,
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.FlowBasemap;
}
