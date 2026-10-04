(function (root) {
  'use strict';

  // Basemap topology loading and projections. Needs d3 and topojson-client.

  const JAPAN_BOX = { lonMin: 122, lonMax: 154, latMin: 20, latMax: 46 };
  const OKINAWA_ID = 47;
  const ANTARCTICA_ID = '010';
  const cache = new Map();

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
          let okinawa = null;
          let mainland = collection.features;
          if (kind === 'japan') {
            okinawa = collection.features.find((f) => Number(f.properties.id) === OKINAWA_ID) || null;
            mainland = collection.features.filter((f) => f !== okinawa);
          } else {
            mainland = collection.features.filter((f) => f.id !== ANTARCTICA_ID);
          }
          return { kind, features: collection.features, mainland, borders, okinawa, topo, object };
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

  function isOkinawaPoint(node, okinawa) {
    if (!node) return false;
    if (node.id === 'jp:47') return true;
    if (!Number.isFinite(node.lon) || !Number.isFinite(node.lat)) return false;
    if (okinawa && d3.geoContains(okinawa, [node.lon, node.lat])) return true;
    // Sea points south of Yoron (27.04N) belong to Okinawa as well.
    return node.lat < 27 && node.lon > 122 && node.lon < 131.5;
  }

  // GeoJSON that covers the nodes, padded to a minimum span so 1-2 places still fit.
  function nodesExtentGeo(nodes, minSpan, center) {
    const list = nodes.filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lon));
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

  /**
   * Builds the projection for the current size and settings.
   * Returns { kind, project(node) -> [x, y] | null, path, insetPath, insetFrame, center, isInset(node) }.
   */
  function createProjection({ basemapKind, projection, centerLongitude, size, nodes, geo, extent, okinawaInset, pad = 36 }) {
    const width = Math.max(10, size.width);
    const height = Math.max(10, size.height);
    const projKind = resolveProjectionKind(projection, basemapKind);
    const main = makeProjection(projKind);
    const isJapan = basemapKind === 'japan';
    const center = isJapan ? 137 : (Number.isFinite(centerLongitude) ? centerLongitude : 0);
    main.rotate([-center, 0]);
    const useInset = isJapan && okinawaInset && geo?.okinawa;
    const okinawaNodes = useInset ? nodes.filter((n) => isOkinawaPoint(n, geo.okinawa)) : [];
    const mainNodes = useInset ? nodes.filter((n) => !okinawaNodes.includes(n)) : nodes;

    let target = null;
    if (extent === 'basemap' && geo) {
      if (isJapan) target = { type: 'FeatureCollection', features: useInset ? geo.mainland : geo.features };
      else if (projKind === 'mercator') target = { type: 'FeatureCollection', features: geo.mainland };
      else target = { type: 'Sphere' };
    } else {
      target = nodesExtentGeo(mainNodes, isJapan ? 1.5 : 15, center);
      if (!target && geo) target = isJapan ? { type: 'FeatureCollection', features: geo.mainland } : { type: 'Sphere' };
      if (!target) target = isJapan ? nodesExtentGeo([{ lon: 137, lat: 36 }], 12, center) : { type: 'Sphere' };
    }
    if (projKind === 'mercator' && target.type === 'Sphere') {
      target = nodesExtentGeo([{ lon: center - 179, lat: -60 }, { lon: center + 179, lat: 75 }], 0, center);
    }
    main.fitExtent([[pad, pad], [width - pad, height - pad]], target);

    let inset = null;
    let insetFrame = null;
    if (useInset) {
      const projectedMain = mainNodes.map((n) => main([n.lon, n.lat])).filter(Boolean);
      const obstacles = projectedMain.map(([x, y]) => [x - 6, y - 6, x + 6, y + 6]);
      insetFrame = root.FlowGeometry.placeInsetFrame(width, height, obstacles);
      inset = makeProjection(projKind).rotate([-center, 0]);
      const p = 10;
      inset.fitExtent([[insetFrame.x + p, insetFrame.y + p], [insetFrame.x + insetFrame.w - p, insetFrame.y + insetFrame.h - p]], geo.okinawa);
      if (inset.scale() > main.scale()) {
        // Never exaggerate Okinawa relative to the mainland; shrink the frame to fit instead.
        inset.scale(main.scale());
        const [[bx0, by0], [bx1, by1]] = d3.geoPath(inset).bounds(geo.okinawa);
        const [tx, ty] = inset.translate();
        inset.translate([tx + (insetFrame.x + p - bx0), ty + (insetFrame.y + p - by0)]);
        insetFrame = { ...insetFrame, w: Math.max(40, bx1 - bx0 + p * 2), h: Math.max(30, by1 - by0 + p * 2) };
      }
    }

    const insetIds = new Set(okinawaNodes.map((n) => n.id));
    const isInset = (node) => !!inset && insetIds.has(node.id);
    const project = (node) => {
      if (!Number.isFinite(node.lon) || !Number.isFinite(node.lat)) return null;
      const p = (isInset(node) ? inset : main)([node.lon, node.lat]);
      return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
    };
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
      sphere: projKind !== 'mercator' && !isJapan,
    };
  }

  root.FlowBasemap = {
    JAPAN_BOX,
    loadTopology,
    resolveBasemapKind,
    resolveProjectionKind,
    createProjection,
    isOkinawaPoint,
    inJapanBox,
  };
})(typeof window !== 'undefined' ? window : globalThis);
