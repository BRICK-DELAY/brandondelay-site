// Flight maps: one per year, drawn from data/flights.json.
//
// data/flights.json looks like:
//   {
//     "places": { "anc": { "name": "Anchorage, Alaska", "lat": 61.17, "lon": -149.99 }, ... },
//     "years":  { "2024": { "home": "den", "flights": [["den", "anc"], ["anc", "den"]] } }
//   }
// Each map crops itself to the places flown to that year.

(function () {
  "use strict";

  const LIBS = ["vendor/map/d3-array.min.js", "vendor/map/d3-geo.min.js", "vendor/map/topojson-client.min.js"];
  const MIN_SPAN_DEG = 28;     // never zoom in further than this many degrees of longitude
  const CURVE = 0.18;          // how much flight lines bow
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let libsReady = null;
  const worlds = {};
  let usStates = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadLibs() {
    if (!libsReady) libsReady = LIBS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
    return libsReady;
  }
  // Coarse outlines for wide views, finer ones when zoomed into a region.
  function loadWorld(detail) {
    if (!worlds[detail]) {
      worlds[detail] = fetch(`vendor/map/countries-${detail}.json`).then((r) => r.json()).then((topo) => ({
        coast: topojson.mesh(topo, topo.objects.countries, (a, b) => a === b),
        borders: topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b),
      }));
    }
    return worlds[detail];
  }
  // US state lines, only used for zoomed-in maps.
  function loadStates() {
    if (!usStates) {
      usStates = fetch("vendor/map/us-states-10m.json").then((r) => r.json())
        .then((topo) => topojson.mesh(topo, topo.objects.states, (a, b) => a !== b))
        .catch(() => null);
    }
    return usStates;
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (lon) => ((lon % 360) + 540) % 360 - 180;

  // Longitude in the middle of the smallest arc that holds every place,
  // so trips across the Pacific aren't split at the map's edge.
  function centerAndSpan(lons) {
    const s = [...new Set(lons.map(norm))].sort((a, b) => a - b);
    if (s.length === 1) return { center: s[0], span: 0 };
    let gap = -1, at = 0;
    for (let i = 0; i < s.length; i++) {
      const next = i === s.length - 1 ? s[0] + 360 : s[i + 1];
      if (next - s[i] > gap) { gap = next - s[i]; at = i; }
    }
    const start = s[(at + 1) % s.length];
    const span = 360 - gap;
    return { center: norm(start + span / 2), span };
  }

  function miles(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function yearData(data, year) {
    const y = data && data.years && data.years[year];
    if (!y || !Array.isArray(y.flights) || !y.flights.length) return null;
    const places = data.places || {};
    const flights = y.flights
      .map((f) => (Array.isArray(f) ? { from: f[0], to: f[1] } : f))
      .filter((f) => places[f.from] && places[f.to] && f.from !== f.to);
    if (!flights.length) return null;
    return { home: y.home, flights, places };
  }

  function statsLine(d) {
    const dest = new Set();
    let total = 0;
    d.flights.forEach((f) => { if (f.to !== d.home) dest.add(f.to); total += miles(d.places[f.from], d.places[f.to]); });
    const n = d.flights.length;
    const roundMiles = total >= 1000 ? Math.round(total / 100) * 100 : Math.round(total);
    return `${n} flight${n === 1 ? "" : "s"} · ${dest.size} place${dest.size === 1 ? "" : "s"} · ${roundMiles.toLocaleString()} miles`;
  }

  async function draw(el, d) {
    const width = el.clientWidth;
    if (!width) return;
    const height = Math.round(Math.min(520, Math.max(240, width * (width < 600 ? 0.72 : 0.42))));
    const pad = Math.max(28, width * 0.06);

    const ids = [...new Set(d.flights.flatMap((f) => [f.from, f.to]))];
    const pts = ids.map((id) => d.places[id]);
    const { center, span } = centerAndSpan(pts.map((p) => p.lon));
    const zoomed = span < 70;
    const [world, states] = await Promise.all([loadWorld(zoomed ? "50m" : "110m"), zoomed ? loadStates() : null]);

    // Fit the map around the places (and the arcs between them), then cap the zoom.
    const shape = { type: "FeatureCollection", features: [
      ...d.flights.map((f) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[d.places[f.from].lon, d.places[f.from].lat], [d.places[f.to].lon, d.places[f.to].lat]] } })),
    ] };
    const projection = d3.geoMercator().rotate([-center, 0]).fitExtent([[pad, pad * 1.1], [width - pad, height - pad * 0.8]], shape);
    const maxScale = (width - 2 * pad) / (MIN_SPAN_DEG * Math.PI / 180);
    if (projection.scale() > maxScale) {
      const path0 = d3.geoPath(projection);
      const [[x0, y0], [x1, y1]] = path0.bounds(shape);
      const ratio = maxScale / projection.scale();
      const [tx, ty] = projection.translate();
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      projection.scale(maxScale).translate([width / 2 - (cx - tx) * ratio, height / 2 - (cy - ty) * ratio]);
    }
    const path = d3.geoPath(projection);

    const P = {};
    ids.forEach((id) => { P[id] = projection([d.places[id].lon, d.places[id].lat]); });

    const arcs = d.flights.map((f, i) => {
      const [x1, y1] = P[f.from], [x2, y2] = P[f.to];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      let nx = dy / len, ny = -dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; } // always bow upward
      const bow = Math.min(len * CURVE, 120);
      const cx = (x1 + x2) / 2 + nx * bow, cy = (y1 + y2) / 2 + ny * bow;
      return `<path class="fm-arc" style="--i:${i}" d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"/>`;
    }).join("");

    // Tap/hover area: as big as possible without covering a neighbouring dot.
    const hitR = (id) => {
      let near = Infinity;
      ids.forEach((o) => { if (o !== id) near = Math.min(near, Math.hypot(P[o][0] - P[id][0], P[o][1] - P[id][1])); });
      return Math.max(5, Math.min(14, near / 2));
    };
    const dots = ids.map((id) => {
      const [x, y] = P[id];
      const home = id === d.home;
      return `<g class="fm-dot${home ? " home" : ""}" data-id="${esc(id)}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc(d.places[id].name)}${home ? " (home)" : ""}">
        <circle class="hit" r="${hitR(id).toFixed(1)}"/><circle class="halo" r="9"/><circle class="core" r="${home ? 4.5 : 3.6}"/></g>`;
    }).join("");

    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Map of flights">
        <path class="fm-coast" d="${path(world.coast) || ""}"/>
        <path class="fm-borders" d="${path(world.borders) || ""}"/>
        ${states ? `<path class="fm-states" d="${path(states) || ""}"/>` : ""}
        <g class="fm-arcs">${arcs}</g>
        <g class="fm-dots">${dots}</g>
      </svg>
      <div class="fm-stats">${statsLine(d)}</div>
      <div class="fm-tip" hidden></div>`;

    const tip = el.querySelector(".fm-tip");
    let pinned = null;
    const show = (g) => {
      const id = g.dataset.id;
      const [x, y] = P[id];
      tip.textContent = d.places[id].name + (id === d.home ? " · home" : "");
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(width - tw - 4, x - tw / 2)) + "px";
      tip.style.top = (y - 44 < 0 ? y + 16 : y - 44) + "px";
      el.querySelectorAll(".fm-dot.on").forEach((n) => n.classList.remove("on"));
      g.classList.add("on");
    };
    const hide = () => { tip.hidden = true; el.querySelectorAll(".fm-dot.on").forEach((n) => n.classList.remove("on")); };
    el.querySelectorAll(".fm-dot").forEach((g) => {
      g.addEventListener("mouseenter", () => show(g));
      g.addEventListener("mouseleave", () => { if (pinned !== g) { pinned ? show(pinned) : hide(); } });
      g.addEventListener("focus", () => show(g));
      g.addEventListener("blur", () => { if (pinned !== g) hide(); });
      g.addEventListener("click", (e) => { e.stopPropagation(); pinned = pinned === g ? null : g; pinned ? show(g) : hide(); });
    });
    el.querySelector("svg").addEventListener("click", () => { pinned = null; hide(); });

    // Draw the flight lines in when the map scrolls into view.
    el.querySelectorAll(".fm-arc").forEach((p) => { const L = p.getTotalLength(); p.style.setProperty("--len", L.toFixed(0)); });
    if (reduceMotion || el.dataset.drawn) { el.classList.add("drawn"); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { el.classList.add("drawn"); el.dataset.drawn = "1"; io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(el);
  }

  const mounted = new Set();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => mounted.forEach((m) => { if (document.body.contains(m.el)) draw(m.el, m.d); else mounted.delete(m); }), 200);
  });

  window.FlightMaps = {
    // Which years have flights, for deciding where to leave room for a map.
    hasYear: (data, year) => !!yearData(data, year),
    // Draws every .flightmap[data-year] inside root.
    async mount(root, data) {
      const els = [...root.querySelectorAll(".flightmap[data-year]")];
      if (!els.length) return;
      try { await loadLibs(); } catch (e) { els.forEach((el) => el.remove()); return; }
      for (const el of els) {
        const d = yearData(data, el.dataset.year);
        if (!d) { el.remove(); continue; }
        mounted.add({ el, d });
        draw(el, d).catch((e) => { console.error(e); el.remove(); });
      }
    },
  };
})();
