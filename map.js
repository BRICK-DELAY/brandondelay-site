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
  const MIN_SPAN_DEG = 9;      // a year's starting view never shows less than this many degrees of longitude
  const MAX_ZOOM = 10;         // how far people can zoom in past the starting view
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

  // Where to put the map's left/right edge: in the widest empty stretch of
  // longitude that no trip crosses, so e.g. Japan–US flights go over the
  // Pacific instead of the long way around. Returns the centre longitude and
  // how many degrees the places span.
  function centerAndSpan(lons, legs) {
    const s = [...new Set(lons.map(norm))].sort((a, b) => a - b);
    if (s.length === 1) return { center: s[0], span: 0 };
    const crossed = (mid) => legs.some(([a, b]) => {
      const delta = norm(b - a), d = norm(mid - a);
      return delta > 0 ? d > 0 && d < delta : d < 0 && d > delta;
    });
    let best = null;
    for (const freeOnly of [true, false]) {
      for (let i = 0; i < s.length; i++) {
        const next = i === s.length - 1 ? s[0] + 360 : s[i + 1];
        const gap = next - s[i];
        if (freeOnly && crossed(norm(s[i] + gap / 2))) continue;
        if (!best || gap > best.gap) best = { gap, at: i };
      }
      if (best) break;
    }
    const start = s[(best.at + 1) % s.length];
    const span = 360 - best.gap;
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
    if (!y || y.hidden) return null; // "hidden": true keeps a year's data but shows no map
    const raw = y.legs || y.flights;
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
    // "home" can be one place or a list (e.g. after moving mid-year).
    const homes = new Set([].concat(y.home || []));
    return { isHome: (id) => homes.has(id), legs, places, order, visits };
  }

  function statsLine(d) {
    let flights = 0, roadTrips = 0, flown = 0;
    d.legs.forEach((l) => {
      if (l.mode === "flight") { flights += l.times; flown += miles(d.places[l.from], d.places[l.to]) * l.times; }
      else if (d.isHome(l.from)) roadTrips += l.times;
    });
    const places = d.order.filter((id) => !d.isHome(id)).length;
    const parts = [];
    if (flights) parts.push(plural(flights, "flight"));
    if (roadTrips) parts.push(plural(roadTrips, "road trip"));
    parts.push(plural(places, "place"));
    if (flown) parts.push(`${(flown >= 1000 ? Math.round(flown / 100) * 100 : Math.round(flown)).toLocaleString()} miles flown`);
    return parts.join(" · ");
  }

  const placeLabel = (d, id) => {
    const v = d.visits[id] || 0;
    if (d.isHome(id)) return `${d.places[id].name} · home`;
    return d.places[id].name + (v > 1 ? ` · ${v} visits` : "");
  };

  async function draw(el, d) {
    const width = el.clientWidth;
    if (!width) return;
    const height = Math.round(Math.min(560, Math.max(260, width * (width < 600 ? 0.8 : 0.45))));
    const pad = Math.max(24, width * 0.045);

    const ids = d.order;
    const { center, span } = centerAndSpan(ids.map((id) => d.places[id].lon),
      d.legs.map((l) => [d.places[l.from].lon, d.places[l.to].lon]));
    const regional = span < 70;
    const [world, states] = await Promise.all([loadWorld(regional ? "50m" : "110m"), regional ? loadStates() : null]);

    // Fit the map around the places (not the true great-circle paths, which
    // swing up toward the pole on long flights), then cap the zoom. Extra room
    // on top leaves space for the lines' upward bow.
    const shape = { type: "MultiPoint", coordinates: ids.map((id) => [d.places[id].lon, d.places[id].lat]) };
    const projection = d3.geoMercator().rotate([-center, 0]).fitExtent([[pad, pad * 1.6], [width - pad, height - pad * 0.7]], shape);
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

    // Distance to the nearest other dot, for sizing tap/hover areas.
    const near = {};
    ids.forEach((id) => {
      near[id] = Infinity;
      ids.forEach((o) => { if (o !== id) near[id] = Math.min(near[id], Math.hypot(P[o][0] - P[id][0], P[o][1] - P[id][1])); });
    });
    // Home last so its ring sits on top of nearby dots.
    const dots = [...ids.filter((id) => !d.isHome(id)), ...ids.filter((id) => d.isHome(id))].map((id) => {
      const home = d.isHome(id);
      return `<g class="fm-dot${home ? " home" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-label="${esc(placeLabel(d, id))}">
        <circle class="hit"/><circle class="halo" r="9"/><circle class="core" r="${home ? 4.5 : 3.6}"/></g>`;
    }).join("");

    const modes = new Set(d.legs.map((l) => l.mode));
    const legend = modes.size > 1
      ? `<span class="fm-legend"><span class="key flight"></span>Flights<span class="key drive"></span>Drives</span>` : "";

    el.innerHTML = `<div class="fm-frame">
        <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Map of this year's travel">
          <g class="fm-zoom">
            <path class="fm-coast" d="${path(world.coast) || ""}"/>
            <path class="fm-borders" d="${path(world.borders) || ""}"/>
            <path class="fm-states" d="${states ? path(states) || "" : ""}"/>
            <g class="fm-arcs">${arcs}</g>
          </g>
          <g class="fm-dots">${dots}</g>
        </svg>
        <div class="fm-controls">
          <button type="button" data-z="in" aria-label="Zoom in">+</button>
          <button type="button" data-z="out" aria-label="Zoom out" disabled>&minus;</button>
          <button type="button" data-z="reset" aria-label="Reset map" hidden>&#8634;</button>
        </div>
      </div>
      <div class="fm-meta"><span class="fm-stats">${statsLine(d)}</span>${legend}</div>
      <div class="fm-tip" hidden></div>`;

    const svg = el.querySelector("svg");
    const zoomG = el.querySelector(".fm-zoom");
    const tip = el.querySelector(".fm-tip");
    const frame = el.querySelector(".fm-frame");
    const dotEls = {};
    el.querySelectorAll(".fm-dot").forEach((g) => { dotEls[g.dataset.id] = g; });

    // ---- zoom & pan
    let k = 1, tx = 0, ty = 0, detailed = regional;
    const screen = (id) => [P[id][0] * k + tx, P[id][1] * k + ty];
    const clampPan = () => {
      tx = Math.min(0, Math.max(width - width * k, tx));
      ty = Math.min(0, Math.max(height - height * k, ty));
    };
    const apply = () => {
      zoomG.setAttribute("transform", `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})`);
      ids.forEach((id) => {
        const [x, y] = screen(id);
        dotEls[id].setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
        dotEls[id].querySelector(".hit").setAttribute("r", Math.max(5, Math.min(14, (near[id] * k) / 2)).toFixed(1));
      });
      el.querySelector('[data-z="out"]').disabled = k <= 1.001;
      el.querySelector('[data-z="in"]').disabled = k >= MAX_ZOOM - 0.001;
      el.querySelector('[data-z="reset"]').hidden = k <= 1.001;
      svg.classList.toggle("zoomed", k > 1.001);
      if (current) placeTip(current);
      // Sharper coastlines (and US state lines) once zoomed in on a world-wide map.
      if (!detailed && k > 2.2) {
        detailed = true;
        Promise.all([loadWorld("50m"), loadStates()]).then(([w, st]) => {
          el.querySelector(".fm-coast").setAttribute("d", path(w.coast) || "");
          el.querySelector(".fm-borders").setAttribute("d", path(w.borders) || "");
          if (st) el.querySelector(".fm-states").setAttribute("d", path(st) || "");
        }).catch(() => {});
      }
    };
    const zoomAt = (factor, cx, cy) => {
      const nk = Math.max(1, Math.min(MAX_ZOOM, k * factor));
      tx = cx - (cx - tx) * (nk / k);
      ty = cy - (cy - ty) * (nk / k);
      k = nk;
      clampPan();
      apply();
    };
    const local = (e) => {
      const r = svg.getBoundingClientRect();
      return [(e.clientX - r.left) * (width / r.width), (e.clientY - r.top) * (height / r.height)];
    };

    el.querySelector(".fm-controls").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.z === "in") zoomAt(1.8, width / 2, height / 2);
      if (b.dataset.z === "out") zoomAt(1 / 1.8, width / 2, height / 2);
      if (b.dataset.z === "reset") { k = 1; tx = 0; ty = 0; apply(); }
    });
    svg.addEventListener("dblclick", (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(2, x, y); });
    // Trackpad pinch (and Ctrl/⌘ + scroll) zooms; plain scrolling still scrolls the page.
    svg.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(Math.exp(-e.deltaY * 0.01), x, y);
    }, { passive: false });

    // Drag to pan when zoomed; two fingers to pinch-zoom.
    const pointers = new Map();
    let last = null, moved = 0;
    svg.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) moved = 0;
      last = null;
    });
    svg.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const now = local(e);
      pointers.set(e.pointerId, now);
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (last) {
          tx += mid[0] - last.mid[0]; ty += mid[1] - last.mid[1];
          zoomAt(dist / last.dist, mid[0], mid[1]);
        }
        last = { dist, mid };
        moved += 10;
      } else if (k > 1.001) {
        tx += now[0] - prev[0]; ty += now[1] - prev[1];
        moved += Math.abs(now[0] - prev[0]) + Math.abs(now[1] - prev[1]);
        clampPan(); apply();
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); last = null; };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("pointerleave", up);

    // ---- place names
    let pinned = null, current = null;
    const placeTip = (id) => {
      const [x, y] = screen(id);
      const r = svg.getBoundingClientRect(), f = r.width / width;
      tip.textContent = placeLabel(d, id);
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = x * f, top = y * f;
      tip.hidden = left < -10 || left > r.width + 10 || top < -10 || top > r.height + 10;
      tip.style.left = Math.max(4, Math.min(r.width - tw - 4, left - tw / 2)) + "px";
      tip.style.top = (top - 44 < 0 ? top + 16 : top - 44) + "px";
    };
    const show = (id) => {
      current = id;
      placeTip(id);
      el.querySelectorAll(".fm-dot.on").forEach((n) => n.classList.remove("on"));
      dotEls[id].classList.add("on");
    };
    const hide = () => { current = null; tip.hidden = true; el.querySelectorAll(".fm-dot.on").forEach((n) => n.classList.remove("on")); };
    const restore = () => (pinned ? show(pinned) : hide());
    Object.entries(dotEls).forEach(([id, g]) => {
      g.addEventListener("mouseenter", () => show(id));
      g.addEventListener("mouseleave", restore);
      g.addEventListener("focus", () => show(id));
      g.addEventListener("blur", restore);
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (moved > 6) return; // that was a drag, not a tap
        pinned = pinned === id ? null : id;
        restore();
      });
    });
    svg.addEventListener("click", () => { if (moved > 6) return; pinned = null; hide(); });

    apply();

    // Draw the lines in when the map scrolls into view.
    el.querySelectorAll(".fm-arc.flight").forEach((p) => p.style.setProperty("--len", p.getTotalLength().toFixed(0)));
    const settle = () => el.classList.add("settled");
    if (reduceMotion || el.dataset.drawn) { el.classList.add("drawn", "instant"); settle(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        el.classList.add("drawn"); el.dataset.drawn = "1"; io.disconnect();
        setTimeout(settle, 1400 + ordered.length * 70);
      }
    }, { threshold: 0.25 });
    io.observe(frame);
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
