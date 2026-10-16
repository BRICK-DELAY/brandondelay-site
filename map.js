// Travel maps: one per year, drawn from data/flights.json.
//
// data/flights.json looks like:
//   {
//     "places": { "anc": { "name": "Anchorage, Alaska", "lat": 61.17, "lon": -149.99 }, ... },
//     "years": {
//       "2024": {
//         "home": "pdx",
//         "legs": [
//           { "from": "pdx", "to": "anc" },                              // a flight (the default)
//           { "from": "pdx", "to": "her", "mode": "drive", "times": 19 } // a drive, done 19 times
//         ]
//       }
//     }
//   }
// Each map crops itself to the places visited that year.

(function () {
  "use strict";

  const LIBS = ["vendor/map/d3-array.min.js", "vendor/map/d3-geo.min.js", "vendor/map/topojson-client.min.js"];
  const MIN_SPAN_DEG = 28;     // never zoom in further than this many degrees of longitude
  const CURVE = 0.18;          // how much flight lines bow (drives bow less)
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
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

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
    const raw = y && (y.legs || y.flights);
    if (!Array.isArray(raw) || !raw.length) return null;
    const places = data.places || {};
    const legs = raw
      .map((l) => (Array.isArray(l) ? { from: l[0], to: l[1] } : l))
      .map((l) => ({ from: l.from, to: l.to, mode: l.mode === "drive" ? "drive" : "flight", times: Math.max(1, Number(l.times) || 1) }))
      .filter((l) => places[l.from] && places[l.to] && l.from !== l.to);
    if (!legs.length) return null;
    // Places in the order they were first visited; how often each was arrived at.
    const order = [], visits = {};
    legs.forEach((l) => {
      [l.from, l.to].forEach((id) => { if (!order.includes(id)) order.push(id); });
      visits[l.to] = (visits[l.to] || 0) + l.times;
    });
    return { home: y.home, legs, places, order, visits };
  }

  function statsLine(d) {
    let flights = 0, roadTrips = 0, flown = 0;
    d.legs.forEach((l) => {
      if (l.mode === "flight") { flights += l.times; flown += miles(d.places[l.from], d.places[l.to]) * l.times; }
      else if (l.from === d.home) roadTrips += l.times;
    });
    const places = d.order.filter((id) => id !== d.home).length;
    const parts = [];
    if (flights) parts.push(plural(flights, "flight"));
    if (roadTrips) parts.push(plural(roadTrips, "road trip"));
    parts.push(plural(places, "place"));
    if (flown) parts.push(`${(flown >= 1000 ? Math.round(flown / 100) * 100 : Math.round(flown)).toLocaleString()} miles flown`);
    return parts.join(" · ");
  }

  const placeLabel = (d, id) => {
    const v = d.visits[id] || 0;
    if (id === d.home) return `${d.places[id].name} · home`;
    return d.places[id].name + (v > 1 ? ` · ${v} visits` : "");
  };

  async function draw(el, d) {
    const width = el.clientWidth;
    if (!width) return;
    const height = Math.round(Math.min(520, Math.max(240, width * (width < 600 ? 0.72 : 0.42))));
    const pad = Math.max(28, width * 0.06);

    const ids = d.order;
    const { center, span } = centerAndSpan(ids.map((id) => d.places[id].lon));
    const zoomed = span < 70;
    const [world, states] = await Promise.all([loadWorld(zoomed ? "50m" : "110m"), zoomed ? loadStates() : null]);

    // Fit the map around the places (not the true great-circle paths, which
    // swing up toward the pole on long flights), then cap the zoom. Extra room
    // on top leaves space for the lines' upward bow.
    const shape = { type: "MultiPoint", coordinates: ids.map((id) => [d.places[id].lon, d.places[id].lat]) };
    const projection = d3.geoMercator().rotate([-center, 0]).fitExtent([[pad, pad * 1.8], [width - pad, height - pad * 0.8]], shape);
    const maxScale = (width - 2 * pad) / (MIN_SPAN_DEG * Math.PI / 180);
    if (projection.scale() > maxScale) {
      const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds(shape);
      const ratio = maxScale / projection.scale();
      const [tx, ty] = projection.translate();
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      projection.scale(maxScale).translate([width / 2 - (cx - tx) * ratio, height / 2 - (cy - ty) * ratio]);
    }
    const path = d3.geoPath(projection);

    const P = {};
    ids.forEach((id) => { P[id] = projection([d.places[id].lon, d.places[id].lat]); });

    // One line per route and mode (there-and-back trips share a line). Drives sit under flights.
    const routes = new Map();
    d.legs.forEach((l) => {
      const key = [l.from, l.to].sort().join("|") + "|" + l.mode;
      if (!routes.has(key)) routes.set(key, l);
    });
    const ordered = [...routes.values()].sort((a, b) => (a.mode === "drive" ? 0 : 1) - (b.mode === "drive" ? 0 : 1));
    const arcs = ordered.map((l, i) => {
      const [x1, y1] = P[l.from], [x2, y2] = P[l.to];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      let nx = dy / len, ny = -dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; } // always bow upward
      const bow = Math.min(len * (l.mode === "drive" ? CURVE / 2 : CURVE), 120);
      const cx = (x1 + x2) / 2 + nx * bow, cy = (y1 + y2) / 2 + ny * bow;
      return `<path class="fm-arc ${l.mode}" style="--i:${i}" d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"/>`;
    }).join("");

    // Tap/hover area: as big as possible without covering a neighbouring dot.
    const hitR = (id) => {
      let near = Infinity;
      ids.forEach((o) => { if (o !== id) near = Math.min(near, Math.hypot(P[o][0] - P[id][0], P[o][1] - P[id][1])); });
      return Math.max(5, Math.min(14, near / 2));
    };
    // Home last so its ring sits on top of nearby dots.
    const dots = [...ids.filter((id) => id !== d.home), ...ids.filter((id) => id === d.home)].map((id) => {
      const [x, y] = P[id];
      const home = id === d.home;
      return `<g class="fm-dot${home ? " home" : ""}" data-id="${esc(id)}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc(placeLabel(d, id))}">
        <circle class="hit" r="${hitR(id).toFixed(1)}"/><circle class="halo" r="9"/><circle class="core" r="${home ? 4.5 : 3.6}"/></g>`;
    }).join("");

    const modes = new Set(d.legs.map((l) => l.mode));
    const legend = modes.size > 1
      ? `<span class="fm-legend"><span class="key flight"></span>Flights<span class="key drive"></span>Drives</span>` : "";

    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Map of this year's travel">
        <path class="fm-coast" d="${path(world.coast) || ""}"/>
        <path class="fm-borders" d="${path(world.borders) || ""}"/>
        ${states ? `<path class="fm-states" d="${path(states) || ""}"/>` : ""}
        <g class="fm-arcs">${arcs}</g>
        <g class="fm-dots">${dots}</g>
      </svg>
      <div class="fm-meta"><span class="fm-stats">${statsLine(d)}</span>${legend}</div>
      <div class="fm-tip" hidden></div>`;

    const tip = el.querySelector(".fm-tip");
    const dotOf = (id) => el.querySelector(`.fm-dot[data-id="${CSS.escape(id)}"]`);
    let pinned = null;
    const show = (id) => {
      const [x, y] = P[id];
      tip.textContent = placeLabel(d, id);
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(width - tw - 4, x - tw / 2)) + "px";
      tip.style.top = (y - 44 < 0 ? y + 16 : y - 44) + "px";
      el.querySelectorAll(".on").forEach((n) => n.classList.remove("on"));
      dotOf(id)?.classList.add("on");
    };
    const hide = () => { tip.hidden = true; el.querySelectorAll(".on").forEach((n) => n.classList.remove("on")); };
    const restore = () => (pinned ? show(pinned) : hide());
    const toggle = (id) => { pinned = pinned === id ? null : id; restore(); };

    el.querySelectorAll(".fm-dot").forEach((n) => {
      const id = n.dataset.id;
      n.addEventListener("mouseenter", () => show(id));
      n.addEventListener("mouseleave", restore);
      n.addEventListener("focus", () => show(id));
      n.addEventListener("blur", restore);
      n.addEventListener("click", (e) => { e.stopPropagation(); toggle(id); });
    });
    el.querySelector("svg").addEventListener("click", () => { pinned = null; hide(); });

    // Draw the lines in when the map scrolls into view.
    el.querySelectorAll(".fm-arc.flight").forEach((p) => p.style.setProperty("--len", p.getTotalLength().toFixed(0)));
    if (reduceMotion || el.dataset.drawn) { el.classList.add("drawn", "instant"); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { el.classList.add("drawn"); el.dataset.drawn = "1"; io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(el);
  }

  const mounted = new Set();
  let resizeTimer, lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return; // ignore phone toolbars sliding in and out
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => mounted.forEach((m) => { if (document.body.contains(m.el)) draw(m.el, m.d); else mounted.delete(m); }), 200);
  });

  window.FlightMaps = {
    // Whether a year has anything to map, for deciding where to leave room.
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
