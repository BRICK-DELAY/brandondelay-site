// Brandon DeLay photography site.
// All content comes from data/site.json and data/photos.json, which the
// uploader at /admin/ keeps up to date. You never need to edit this file.

(function () {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const app = document.getElementById("app");
  const nav = document.getElementById("nav");
  const topbar = document.getElementById("topbar");
  const footer = document.getElementById("footer");

  let site = {};
  let flights = {};
  let trips = [];
  let years = []; // [{year, trips:[...]}], newest first

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return { y, m, d }; };
  const yearOf = (t) => parseDay(t.start).y;

  function dateRange(t, long) {
    const a = parseDay(t.start), b = parseDay(t.end || t.start);
    const M = long ? MONTHS_LONG : MONTHS;
    if (a.y !== b.y) return `${M[a.m - 1]} ${a.d}, ${a.y} – ${M[b.m - 1]} ${b.d}, ${b.y}`;
    if (a.m !== b.m) return `${M[a.m - 1]} ${a.d} – ${M[b.m - 1]} ${b.d}, ${a.y}`;
    if (a.d !== b.d) return `${M[a.m - 1]} ${a.d}–${b.d}, ${a.y}`;
    return `${M[a.m - 1]} ${a.d}, ${a.y}`;
  }
  // Month and year only, for trip tiles: "June 2024", "June – July 2024", "Dec 2024 – Jan 2025".
  function monthRange(t) {
    const a = parseDay(t.start), b = parseDay(t.end || t.start);
    if (a.y !== b.y) return `${MONTHS[a.m - 1]} ${a.y} – ${MONTHS[b.m - 1]} ${b.y}`;
    if (a.m !== b.m) return `${MONTHS_LONG[a.m - 1]} – ${MONTHS_LONG[b.m - 1]} ${a.y}`;
    return `${MONTHS_LONG[a.m - 1]} ${a.y}`;
  }
  const monthLabel = (t) => MONTHS[parseDay(t.start).m - 1];
  const coverOf = (t) => t.cover || (t.photos[0] && t.photos[0].file);
  const thumbFor = (t, file) => { const p = t.photos.find((x) => x.file === file); return p ? p.thumb : file; };

  async function getJSON(url) {
    // A unique address each time skips any saved copy, so new photos and trips show up right away.
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(url + " " + res.status);
    return res.json();
  }

  // ---------- data ----------
  async function load() {
    const [s, p, f] = await Promise.all([
      getJSON("data/site.json").catch(() => ({})),
      getJSON("data/photos.json").catch(() => ({ trips: [] })),
      getJSON("data/flights.json").catch(() => ({})),
    ]);
    flights = f || {};
    site = s || {};
    trips = (p.trips || []).filter((t) => t.photos && t.photos.length);
    trips.sort((a, b) => (b.start || "").localeCompare(a.start || ""));
    const byYear = new Map();
    for (const t of trips) {
      const y = yearOf(t);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(t);
    }
    // Newest first within each year, except trips set to always show first/last.
    const rank = (t) => (t.position === "first" ? -1 : t.position === "last" ? 1 : 0);
    years = [...byYear.entries()].sort((a, b) => b[0] - a[0])
      .map(([year, list]) => ({ year, trips: list.sort((a, b) => rank(a) - rank(b) || (b.start || "").localeCompare(a.start || "")) }));
    trips = years.flatMap((y) => y.trips);
    // Years with a travel map but no photos yet still get a section.
    Object.keys((flights && flights.years) || {}).forEach((key) => {
      const year = Number(key);
      if (year && !byYear.has(year) && window.FlightMaps && FlightMaps.hasYear(flights, key)) years.push({ year, trips: [] });
    });
    years.sort((a, b) => b.year - a.year);
  }

  // ---------- chrome ----------
  function renderChrome() {
    const name = site.name || "Brandon DeLay";
    document.getElementById("brand").textContent = name;

    const chev = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
    let html = "";
    for (const y of years) {
      html += `<div class="nav-item" data-year="${y.year}">
        <button class="nav-year" aria-expanded="false" aria-haspopup="true">${y.year}${chev}</button>
        <div class="dropdown" role="menu">
          ${y.trips.map((t) => `<a role="menuitem" href="#/trip/${encodeURIComponent(t.id)}">${esc(t.name)}<span class="when">${monthLabel(t)}</span></a>`).join("")}
          <a class="all" role="menuitem" href="#/year/${y.year}">${y.trips.length ? `All of ${y.year}` : "Travel map"}</a>
        </div>
      </div>`;
    }
    html += `<a class="nav-link" href="#/about" data-route="about">About</a>`;
    for (const l of site.links || []) {
      if (l && l.label && l.url) html += `<a class="nav-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`;
    }
    nav.innerHTML = html;

    nav.querySelectorAll(".nav-year").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = btn.parentElement;
        const wasOpen = item.classList.contains("open");
        closeDropdowns();
        if (!wasOpen) { item.classList.add("open"); btn.setAttribute("aria-expanded", "true"); }
      });
    });

    const links = [];
    if (site.email) links.push(`<a href="mailto:${esc(site.email)}">Email</a>`);
    if (site.instagram) {
      const handle = String(site.instagram).replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
      links.push(`<a href="https://instagram.com/${esc(handle)}" target="_blank" rel="noopener">Instagram</a>`);
    }
    footer.innerHTML = `<span>© ${new Date().getFullYear()} ${esc(name)}. All photos are mine; please ask before using them.</span><span class="links">${links.join("")}</span>`;
  }

  function closeDropdowns() {
    nav.querySelectorAll(".nav-item.open").forEach((i) => {
      i.classList.remove("open");
      i.querySelector(".nav-year").setAttribute("aria-expanded", "false");
    });
  }
  function closeMenu() {
    document.body.classList.remove("menu-open", "no-scroll");
    document.getElementById("menuToggle").setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (e) => { if (!nav.contains(e.target)) closeDropdowns(); });
  document.getElementById("menuToggle").addEventListener("click", () => {
    const open = !document.body.classList.contains("menu-open");
    document.body.classList.toggle("menu-open", open);
    document.body.classList.toggle("no-scroll", open);
    document.getElementById("menuToggle").setAttribute("aria-expanded", String(open));
  });

  function setActive(route, param) {
    nav.querySelectorAll(".active").forEach((el) => el.classList.remove("active"));
    if (route === "about") nav.querySelector('[data-route="about"]')?.classList.add("active");
    let y = null;
    if (route === "year") y = param;
    if (route === "trip") { const t = trips.find((x) => x.id === param); if (t) y = yearOf(t); }
    if (y) nav.querySelector(`.nav-item[data-year="${y}"] .nav-year`)?.classList.add("active");
  }

  // ---------- pages ----------
  function card(t) {
    const cover = coverOf(t);
    return `<a class="card" href="#/trip/${encodeURIComponent(t.id)}">
      <div class="card-img"><img src="${esc(thumbFor(t, cover))}" alt="${esc(t.name)}" loading="lazy">${t.credit ? `<span class="card-credit">${esc(t.credit)}</span>` : ""}</div>
      <div class="card-meta"><h3>${esc(t.name)}</h3><span>${monthRange(t)}</span></div>
    </a>`;
  }

  // A travel map goes at the top of each year when data/flights.json has (unhidden) trips for it.
  const mapSlot = (year) => (window.FlightMaps && FlightMaps.hasYear(flights, year) ? `<div class="flightmap" data-year="${year}"></div>` : "");
  const tripCount = (y) => (y.trips.length ? `${y.trips.length} ${y.trips.length === 1 ? "trip" : "trips"}` : "Photos coming soon");

  // Every photo from a year for the Gallery view, oldest first. Trips with a
  // photo credit (taken by someone else) are left out.
  const galleryPhotos = (y) => y.trips.filter((t) => !t.credit)
    .flatMap((t) => t.photos.map((p) => ({ ...p, tripName: t.name })))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // Which view each year is showing; remembered on this device.
  const VIEW_KEY = "bd-year-view";
  let yearView = {};
  try { yearView = JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch (e) { yearView = {}; }
  const viewOf = (y) => (yearView[y.year] === "gallery" && galleryPhotos(y).length ? "gallery" : "trips");

  function yearHead(y) {
    const canGallery = y.trips.length && galleryPhotos(y).length;
    const v = viewOf(y);
    const right = canGallery
      ? `<div class="view-toggle" role="group" aria-label="Show ${y.year} as">
          <button type="button" data-view="trips" aria-pressed="${v === "trips"}">${tripCount(y)}</button>
          <button type="button" data-view="gallery" aria-pressed="${v === "gallery"}">Gallery</button>
        </div>`
      : `<span>${tripCount(y)}</span>`;
    return `<div class="section-head"><h2>${y.year}</h2>${right}</div>`;
  }
  function yearBody(y) {
    if (!y.trips.length) return "";
    if (viewOf(y) === "gallery") return `<div class="justified inset" data-gallery="${y.year}"></div>`;
    return `<div class="cards">${y.trips.map(card).join("")}</div>`;
  }
  // The travel map sits under the trip tiles in Trips view, and on top in Gallery view.
  function yearSection(y, extraClass) {
    const gallery = viewOf(y) === "gallery";
    return `<section class="section${extraClass || ""}" data-year-section="${y.year}">
      ${yearHead(y)}
      ${gallery ? mapSlot(y.year) : ""}
      <div class="year-body">${yearBody(y)}</div>
      ${gallery ? "" : mapSlot(y.year)}
    </section>`;
  }
  // Move an already-drawn map (keeps its zoom) to match the view.
  function placeMap(sec, view) {
    const map = sec.querySelector(".flightmap"), body = sec.querySelector(".year-body");
    if (!map) return;
    if (view === "gallery") body.before(map); else body.after(map);
  }
  // Fill in gallery grids and wire up the Trips/Gallery switches inside root.
  function wireYears(root) {
    root.querySelectorAll("[data-gallery]").forEach((el) => {
      const y = years.find((x) => String(x.year) === el.dataset.gallery);
      if (y) setGrid(el, galleryPhotos(y));
    });
    root.querySelectorAll("[data-year-section]").forEach((sec) => {
      const y = years.find((x) => String(x.year) === sec.dataset.yearSection);
      sec.querySelectorAll(".view-toggle button").forEach((b) => b.addEventListener("click", () => {
        if (viewOf(y) === b.dataset.view) return;
        yearView[y.year] = b.dataset.view;
        try { localStorage.setItem(VIEW_KEY, JSON.stringify(yearView)); } catch (e) { /* private mode */ }
        sec.querySelectorAll(".view-toggle button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        const body = sec.querySelector(".year-body");
        body.innerHTML = yearBody(y);
        placeMap(sec, b.dataset.view);
        wireYears(body);
      }));
    });
  }
  const mountMaps = () => { if (window.FlightMaps) FlightMaps.mount(app, flights); };

  function heroFile() {
    if (site.heroPhoto) return site.heroPhoto;
    return trips[0] ? coverOf(trips[0]) : null;
  }

  function renderHome() {
    const hero = heroFile();
    let html = `<section class="hero${hero ? "" : " empty"}">
      ${hero ? `<picture>${site.heroPhotoPhone && site.heroPhotoPhone !== hero ? `<source media="(orientation: portrait)" srcset="${esc(site.heroPhotoPhone)}">` : ""}<img src="${esc(hero)}" alt=""></picture>` : ""}
      <div class="hero-text">
        <h1>${esc(site.tagline || site.name || "Brandon DeLay")}</h1>
        ${site.intro ? `<p>${esc(site.intro)}</p>` : ""}
      </div>
      ${trips.length ? `<a class="scroll-cue" href="#trips" data-scroll>Trips ↓</a>` : ""}
    </section>`;
    html += `<div id="trips">`;
    if (!years.length) {
      html += `<section class="section"><p class="empty-note">No photos yet. Add your first trip from the uploader at <code>/admin</code>.</p></section>`;
    }
    for (const y of years) html += yearSection(y);
    html += `</div>`;
    app.innerHTML = html;
    wireYears(app);
    mountMaps();
    app.querySelector("[data-scroll]")?.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("trips").scrollIntoView({ behavior: "smooth" });
    });
    topbar.classList.add("over-hero");
    document.title = `${site.name || "Brandon DeLay"} · Photography`;
  }

  function renderYear(year) {
    const y = years.find((x) => String(x.year) === String(year));
    if (!y) return renderNotFound();
    app.innerHTML = yearSection(y, " page");
    wireYears(app);
    mountMaps();
    document.title = `${y.year} · ${site.name || "Brandon DeLay"}`;
  }

  function renderTrip(id) {
    const t = trips.find((x) => x.id === id);
    if (!t) return renderNotFound();
    const idx = trips.indexOf(t);
    const newer = trips[idx - 1], older = trips[idx + 1];
    app.innerHTML = `<div class="page">
      <header class="trip-head">
        <div class="crumbs"><a href="#/year/${yearOf(t)}">${yearOf(t)}</a></div>
        <h1>${esc(t.name)}</h1>
        <p>${dateRange(t, true)} · ${t.photos.length} ${t.photos.length === 1 ? "photo" : "photos"}${t.credit ? ` · ${esc(t.credit)}` : ""}</p>
      </header>
      <div class="justified" id="grid"></div>
      <nav class="trip-pager">
        ${older ? `<a href="#/trip/${encodeURIComponent(older.id)}">← Previous trip<strong>${esc(older.name)}</strong></a>` : ""}
        ${newer ? `<a class="next" href="#/trip/${encodeURIComponent(newer.id)}">Next trip →<strong>${esc(newer.name)}</strong></a>` : ""}
      </nav>
    </div>`;
    setGrid(document.getElementById("grid"), t.photos.map((p) => ({ ...p, tripName: t.name })));
    document.title = `${t.name} · ${site.name || "Brandon DeLay"}`;
  }

  // Justified rows: every row fills the width exactly and photos keep their shape and order.
  // Used for trip pages and year galleries; each photo carries its trip's name.
  function setGrid(grid, photos) {
    grid._photos = photos;
    layoutGrid(grid);
  }
  function layoutGrid(grid) {
    const photos = grid._photos;
    if (!photos) return;
    const cs = getComputedStyle(grid);
    const width = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const phone = window.innerWidth < 600;
    const gap = phone ? 6 : 8;
    const ratio = (p) => (p.w || 3) / (p.h || 2);
    const rows = [];

    if (phone) {
      // Phones: big photos, order not kept. Wide shots fill the screen width;
      // tall and square ones sit two side by side. Alternate them for rhythm.
      const wide = photos.filter((p) => ratio(p) >= 1.15);
      const tall = photos.filter((p) => ratio(p) < 1.15);
      const pairs = [];
      for (let i = 0; i < tall.length; i += 2) pairs.push(tall.slice(i, i + 2));
      while (wide.length || pairs.length) {
        if (wide.length) rows.push([wide.shift()]);
        if (wide.length && wide.length > pairs.length * 2) rows.push([wide.shift()]);
        if (pairs.length) rows.push(pairs.shift());
      }
    } else {
      // Larger screens: justified rows in date order.
      const target = window.innerWidth < 1100 ? 250 : 320;
      let row = [], rowRatio = 0;
      photos.forEach((p) => {
        row.push(p);
        rowRatio += ratio(p);
        if (width / rowRatio <= target) { rows.push(row); row = []; rowRatio = 0; }
      });
      if (row.length) rows.push(Object.assign(row, { last: true, target }));
    }

    // Build the rows; `shown` is the on-screen order, which the lightbox follows.
    const shown = [];
    let html = "";
    rows.forEach((row) => {
      const rowRatio = row.reduce((n, p) => n + ratio(p), 0);
      let h = (width - gap * (row.length - 1)) / rowRatio;
      if (row.last && h > row.target * 1.25) h = row.target;
      if (phone && row.length === 1 && ratio(row[0]) < 1.15) h = Math.min(h, width * 1.25); // lone tall photo
      html += `<div class="jrow" style="height:${h.toFixed(1)}px;gap:${gap}px;margin-bottom:${gap}px">` + row.map((p) => {
        const i = shown.push(p) - 1;
        const w = h * ratio(p);
        const thumbW = Math.round(ratio(p) >= 1 ? 720 : 720 * ratio(p));
        const fullW = Math.round(p.w || 2048);
        return `<button data-i="${i}" style="width:${w.toFixed(1)}px" aria-label="Open photo ${i + 1}"><img src="${esc(p.thumb)}" srcset="${esc(p.thumb)} ${thumbW}w, ${esc(p.file)} ${fullW}w" sizes="${Math.ceil(w)}px" alt="" loading="lazy" onload="this.classList.add('loaded')"></button>`;
      }).join("") + `</div>`;
    });
    grid.innerHTML = html;
    grid.querySelectorAll("img").forEach((img) => { if (img.complete) img.classList.add("loaded"); });
    grid.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => openLightbox(shown, +b.dataset.i)));
  }
  let resizeTimer, gridWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === gridWidth) return; // phone toolbars sliding in/out
    gridWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => app.querySelectorAll("#grid, [data-gallery]").forEach(layoutGrid), 120);
  });

  function renderAbout() {
    const contact = [];
    if (site.email) contact.push(`<a class="btn" href="mailto:${esc(site.email)}">Email me</a>`);
    if (site.instagram) {
      const handle = String(site.instagram).replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
      contact.push(`<a class="btn" href="https://instagram.com/${esc(handle)}" target="_blank" rel="noopener">Instagram</a>`);
    }
    app.innerHTML = `<section class="section page about">
      <h1>About</h1>
      <p>${esc(site.about || "")}</p>
      ${contact.length ? `<div class="contact">${contact.join("")}</div>` : ""}
    </section>`;
    document.title = `About · ${site.name || "Brandon DeLay"}`;
  }

  function renderNotFound() {
    app.innerHTML = `<section class="section page"><h2 style="font-family:var(--serif);font-size:44px;font-weight:500;margin:0 0 12px">Not found</h2><p class="empty-note" style="padding:0">That page doesn't exist anymore. <a href="#/">Go home</a></p></section>`;
  }

  // ---------- lightbox ----------
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lbImg");
  const lbCaption = document.getElementById("lbCaption");
  let lbIndex = 0, lbPhotos = [];

  function showLightbox(i) {
    const photos = lbPhotos;
    lbIndex = (i + photos.length) % photos.length;
    const p = photos[lbIndex];
    lbImg.src = p.file;
    let when = "";
    if (p.date) { const d = parseDay(p.date); when = `${MONTHS_LONG[d.m - 1]} ${d.d}, ${d.y} · `; }
    lbCaption.textContent = `${p.tripName || ""} · ${when}${lbIndex + 1} / ${photos.length}`;
    // warm up the neighbours so arrowing feels instant
    [lbIndex + 1, lbIndex - 1].forEach((n) => { const q = photos[(n + photos.length) % photos.length]; if (q) new Image().src = q.file; });
  }
  function openLightbox(photos, i) {
    lbPhotos = photos;
    lb.hidden = false;
    document.body.classList.add("no-scroll");
    showLightbox(i);
  }
  function closeLightbox() {
    lb.hidden = true;
    lbImg.removeAttribute("src");
    document.body.classList.remove("no-scroll");
  }
  document.getElementById("lbClose").addEventListener("click", closeLightbox);
  document.getElementById("lbPrev").addEventListener("click", (e) => { e.stopPropagation(); showLightbox(lbIndex - 1); });
  document.getElementById("lbNext").addEventListener("click", (e) => { e.stopPropagation(); showLightbox(lbIndex + 1); });
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) { if (e.key === "Escape") { closeDropdowns(); closeMenu(); } return; }
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowRight") showLightbox(lbIndex + 1);
    if (e.key === "ArrowLeft") showLightbox(lbIndex - 1);
  });
  let touchX = null;
  lb.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) showLightbox(lbIndex + (dx < 0 ? 1 : -1));
    else if (e.target === lb || e.target === lbImg) closeLightbox();
    touchX = null;
  });

  // ---------- router ----------
  function route() {
    const hash = location.hash.replace(/^#\/?/, "");
    const [name, ...rest] = hash.split("/");
    const param = decodeURIComponent(rest.join("/"));
    if (!lb.hidden) closeLightbox();
    closeDropdowns();
    closeMenu();
    topbar.classList.remove("over-hero");
    if (!name) renderHome();
    else if (name === "trip") renderTrip(param);
    else if (name === "year") renderYear(param);
    else if (name === "about") renderAbout();
    else renderNotFound();
    setActive(name, param);
    if (name !== "" || !location.hash.includes("trips")) window.scrollTo(0, 0);
  }

  window.addEventListener("scroll", () => {
    if (!location.hash.replace(/^#\/?/, "")) topbar.classList.toggle("over-hero", window.scrollY < window.innerHeight * 0.6);
  }, { passive: true });
  window.addEventListener("hashchange", route);

  load().then(() => { renderChrome(); route(); }).catch((err) => {
    console.error(err);
    app.innerHTML = `<section class="section page"><p class="empty-note">Couldn't load the photos. Please refresh.</p></section>`;
  });
})();
