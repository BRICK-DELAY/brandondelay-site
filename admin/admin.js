// Photo uploader for the Brandon DeLay site.
//
// How it works: photos are shrunk to web size right here in the browser, the
// date and location are read from each photo, photos are grouped into trips
// automatically, and everything is saved straight to the site's GitHub
// repository. GitHub Pages then republishes the site within about a minute.

(function () {
  "use strict";

  const STORE_KEY = "bd-uploader";
  const FULL_EDGE = 2048;   // longest side of the photo people see full-screen
  const THUMB_EDGE = 720;   // longest side of grid thumbnails
  const TRIP_GAP_DAYS = 3;  // photos more than this many days apart start a new trip
  const MATCH_SLACK_DAYS = 2; // how close to an existing trip's dates counts as "same trip"
  const PHOTOS_PER_SAVE = 25;

  const view = document.getElementById("view");
  const tabs = document.getElementById("tabs");
  const toastEl = document.getElementById("toast");

  let cfg = loadCfg();
  let busy = false;

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, "0");
  const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const dayOf = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
  function rangeLabel(a, b) {
    const A = new Date(dayOf(a)), B = new Date(dayOf(b || a));
    if (A.getFullYear() !== B.getFullYear()) return `${MONTHS[A.getMonth()]} ${A.getDate()}, ${A.getFullYear()} – ${MONTHS[B.getMonth()]} ${B.getDate()}, ${B.getFullYear()}`;
    if (A.getMonth() !== B.getMonth()) return `${MONTHS[A.getMonth()]} ${A.getDate()} – ${MONTHS[B.getMonth()]} ${B.getDate()}, ${A.getFullYear()}`;
    if (A.getDate() !== B.getDate()) return `${MONTHS[A.getMonth()]} ${A.getDate()}–${B.getDate()}, ${A.getFullYear()}`;
    return `${MONTHS[A.getMonth()]} ${A.getDate()}, ${A.getFullYear()}`;
  }
  const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip";
  const rand = () => Math.random().toString(36).slice(2, 6);

  let toastTimer;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = "toast" + (isErr ? " err" : "");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, isErr ? 7000 : 3500);
  }

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCfg() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* private mode: stays for this visit only */ }
  }

  window.addEventListener("beforeunload", (e) => { if (busy) { e.preventDefault(); e.returnValue = ""; } });

  // ---------------------------------------------------------------- GitHub
  const API = () => cfg.api || "https://api.github.com";

  async function gh(method, path, body, accept) {
    const res = await fetch(API() + path, {
      method,
      headers: {
        Authorization: "Bearer " + cfg.token,
        Accept: accept || "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).message || ""; } catch (e) { /* ignore */ }
      const err = new Error(friendlyError(res.status, msg));
      err.status = res.status;
      throw err;
    }
    if (accept && accept.includes("raw")) return res.text();
    return res.status === 204 ? null : res.json();
  }

  function friendlyError(status, msg) {
    if (status === 401) return "GitHub didn't accept your key. It may have expired. Go to Settings → Disconnect, then connect again with a new key.";
    if (status === 403 && /rate limit/i.test(msg)) return "GitHub says we're going too fast. Wait a few minutes and try again.";
    if (status === 403) return "Your key can't save to this site. Make sure it has \"Contents: Read and write\" permission.";
    if (status === 404) return "Couldn't find that repository. Check the GitHub username and repository name.";
    return `GitHub error ${status}${msg ? ": " + msg : ""}`;
  }

  const repoPath = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

  async function readJSON(path, ref) {
    const text = await gh("GET", `${repoPath()}/contents/${path}?ref=${encodeURIComponent(ref || cfg.branch)}`, null, "application/vnd.github.raw+json");
    return JSON.parse(text);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function createBlob(blob) {
    const content = await blobToBase64(blob);
    const out = await gh("POST", `${repoPath()}/git/blobs`, { content, encoding: "base64" });
    return out.sha;
  }

  // Makes one save ("commit") to the site. `change` gets fresh copies of
  // photos.json and site.json, edits them in place, and returns any extra
  // files to add ({path, sha}) or remove ({path, remove:true}).
  async function save(message, change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await gh("GET", `${repoPath()}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
      const head = ref.object.sha;
      const commit = await gh("GET", `${repoPath()}/git/commits/${head}`);
      const photos = await readJSON("data/photos.json", head);
      const site = await readJSON("data/site.json", head);
      const before = { photos: JSON.stringify(photos), site: JSON.stringify(site) };
      const files = (await change(photos, site)) || [];

      const tree = files.map((f) => f.remove
        ? { path: f.path, mode: "100644", type: "blob", sha: null }
        : { path: f.path, mode: "100644", type: "blob", sha: f.sha });
      if (JSON.stringify(photos) !== before.photos) tree.push({ path: "data/photos.json", mode: "100644", type: "blob", content: JSON.stringify(photos, null, 2) + "\n" });
      if (JSON.stringify(site) !== before.site) tree.push({ path: "data/site.json", mode: "100644", type: "blob", content: JSON.stringify(site, null, 2) + "\n" });
      if (!tree.length) return { photos, site };

      const newTree = await gh("POST", `${repoPath()}/git/trees`, { base_tree: commit.tree.sha, tree });
      const newCommit = await gh("POST", `${repoPath()}/git/commits`, { message, tree: newTree.sha, parents: [head] });
      try {
        await gh("PATCH", `${repoPath()}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { sha: newCommit.sha });
        return { photos, site };
      } catch (err) {
        // Someone (probably another phone/computer) saved at the same moment: redo on top of theirs.
        if (err.status !== 422 || attempt === 2) throw err;
      }
    }
  }

  // Images: use the published copy, and fall back to GitHub's copy for photos
  // saved in the last minute that the live site hasn't picked up yet.
  const imgSrc = (path) => "../" + path;
  const rawSrc = (path) => `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${path}`;
  const imgTag = (path, alt) => `<img src="${esc(imgSrc(path))}" data-raw="${esc(rawSrc(path))}" alt="${esc(alt || "")}" loading="lazy">`;
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName === "IMG" && img.dataset.raw && img.src !== img.dataset.raw) img.src = img.dataset.raw;
  }, true);

  // ---------------------------------------------------------------- connect screen
  function guessRepo() {
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const owner = host.split(".")[0];
      const first = location.pathname.split("/").filter(Boolean)[0];
      return { owner, repo: first && first !== "admin" ? first : `${owner}.github.io` };
    }
    return {};
  }

  function renderConnect(errMsg) {
    tabs.hidden = true;
    const g = guessRepo();
    view.innerHTML = `
      <h1>Connect to your site</h1>
      <p class="muted">You only do this once on each phone or computer. After that, this page remembers you.</p>
      <div class="panel">
        <h2>Make a "key" on GitHub</h2>
        <p class="muted small">This key lets this page save photos to your site. Keep it private, like a password.</p>
        <ol class="steps">
          <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → New fine-grained token</a> and sign in if asked.</li>
          <li><b>Token name:</b> type <code>Photo uploader</code>. <b>Expiration:</b> choose the longest option offered.</li>
          <li><b>Repository access:</b> choose <b>Only select repositories</b>, then pick your website repository.</li>
          <li><b>Permissions:</b> under Repository permissions, find <b>Contents</b> and set it to <b>Read and write</b>.</li>
          <li>Click <b>Generate token</b> at the bottom, then <b>copy</b> the long code that starts with <code>github_pat_</code>.</li>
        </ol>
      </div>
      <form class="panel" id="connectForm" autocomplete="off">
        <div class="row">
          <label class="field"><span>Your GitHub username</span><input type="text" name="owner" value="${esc(cfg.owner || g.owner || "")}" autocapitalize="none" spellcheck="false" required></label>
          <label class="field"><span>Website repository name</span><input type="text" name="repo" value="${esc(cfg.repo || g.repo || "")}" autocapitalize="none" spellcheck="false" required></label>
        </div>
        <label class="field"><span>Paste your key</span><input type="password" name="token" placeholder="github_pat_…" autocapitalize="none" spellcheck="false" required></label>
        ${errMsg ? `<p style="color:var(--danger)">${esc(errMsg)}</p>` : ""}
        <button class="btn primary big" type="submit">Connect</button>
      </form>`;
    document.getElementById("connectForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const next = { ...cfg, owner: String(f.get("owner")).trim(), repo: String(f.get("repo")).trim(), token: String(f.get("token")).trim() };
      const btn = e.target.querySelector("button");
      btn.disabled = true; btn.textContent = "Checking…";
      const prev = cfg;
      cfg = next;
      try {
        const repo = await gh("GET", repoPath());
        if (repo.permissions && repo.permissions.push === false) throw new Error("That key can only read the site, not save to it. Set Contents to \"Read and write\".");
        cfg.branch = repo.default_branch || "main";
        saveCfg();
        toast("Connected!");
        start();
      } catch (err) {
        cfg = prev;
        renderConnect(err.message);
      }
    });
  }

  // ---------------------------------------------------------------- tabs
  let tab = "add";
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    if (busy) return toast("Hang on, still saving…");
    tab = b.dataset.tab;
    showTab();
  });
  function showTab() {
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    if (tab === "add") renderAdd();
    if (tab === "manage") renderManage();
    if (tab === "settings") renderSettings();
    window.scrollTo(0, 0);
  }
  function start() {
    if (!cfg.token || !cfg.owner || !cfg.repo || !cfg.branch) return renderConnect();
    tabs.hidden = false;
    showTab();
  }

  // ---------------------------------------------------------------- add photos
  let pending = [];  // photos chosen but not saved yet
  let groups = [];   // auto-made trip groups for the pending photos
  let liveTrips = []; // trips already on the site (for matching)

  function renderAdd() {
    if (pending.length) return renderGroups();
    view.innerHTML = `
      <h1>Add photos</h1>
      <p class="muted">Pick as many as you like. They'll be sorted into trips by the date they were taken, and you can fix anything before it goes live.</p>
      <label class="drop" id="drop">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/></svg>
        <strong>Choose photos</strong>
        <span class="muted small">On a computer you can also drag photos here</span>
        <input type="file" id="fileInput" accept="image/*,.heic,.heif" multiple>
      </label>
      <p class="muted small" style="margin-top:16px">Tip for iPhone: when picking photos, tap <b>Options</b> at the top and make sure <b>Location</b> is on. That lets this page name new trips for you.</p>`;
    const input = document.getElementById("fileInput");
    input.addEventListener("change", () => { if (input.files.length) addFiles([...input.files]); });
    const drop = document.getElementById("drop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => {
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/") || /\.hei[cf]$/i.test(f.name));
      if (files.length) addFiles(files);
    });
  }

  async function addFiles(files) {
    busy = true;
    const items = files.map((file) => ({ id: rand() + rand(), file, status: "waiting" }));
    pending.push(...items);
    view.innerHTML = `
      <h1>Getting your photos ready…</h1>
      <p class="muted" id="prepLabel">0 of ${items.length}</p>
      <div class="progress"><div id="prepBar"></div></div>
      <p class="muted small">Shrinking them to web size and reading when and where each was taken. Keep this page open.</p>`;
    try { liveTrips = (await readJSON("data/photos.json")).trips || []; } catch (e) { liveTrips = []; }

    let done = 0;
    for (const it of items) {
      try { await prepare(it); it.status = "ready"; }
      catch (err) { console.error(err); it.status = "failed"; }
      done++;
      const bar = document.getElementById("prepBar"), label = document.getElementById("prepLabel");
      if (bar) bar.style.width = (done / items.length * 100) + "%";
      if (label) label.textContent = `${done} of ${items.length}`;
    }
    const failed = pending.filter((p) => p.status === "failed");
    pending = pending.filter((p) => p.status === "ready");
    if (failed.length) toast(`${failed.length} file${failed.length > 1 ? "s" : ""} couldn't be read and ${failed.length > 1 ? "were" : "was"} skipped.`, true);
    busy = false;
    if (!pending.length) return renderAdd();
    groups = await autoGroup(pending);
    renderGroups();
  }

  const isHeic = (f) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

  let heicLoader = null;
  function loadHeic2any() {
    if (!heicLoader) heicLoader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "../vendor/heic2any.min.js";
      s.onload = () => resolve(window.heic2any);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return heicLoader;
  }

  async function decode(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  function resize(source, edge, quality) {
    const w = source.width, h = source.height;
    const s = Math.min(1, edge / Math.max(w, h));
    const cw = Math.round(w * s), chh = Math.round(h * s);
    const c = document.createElement("canvas");
    c.width = cw; c.height = chh;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, cw, chh);
    return new Promise((resolve, reject) => c.toBlob((b) => b ? resolve({ blob: b, w: cw, h: chh }) : reject(new Error("encode failed")), "image/jpeg", quality));
  }

  async function prepare(it) {
    const f = it.file;
    let meta = null;
    try { meta = await exifr.parse(f, { tiff: true, exif: true, gps: true, ifd1: false }); } catch (e) { meta = null; }
    const taken = meta && (meta.DateTimeOriginal || meta.CreateDate || meta.DateTime);
    if (taken instanceof Date && !isNaN(taken)) { it.date = localISO(taken); it.guessedDate = false; }
    else { it.date = localISO(new Date(f.lastModified || Date.now())); it.guessedDate = true; }
    if (meta && typeof meta.latitude === "number" && typeof meta.longitude === "number" && (meta.latitude || meta.longitude)) {
      it.lat = meta.latitude; it.lon = meta.longitude;
    }

    let source;
    try { source = await decode(f); }
    catch (e) {
      if (!isHeic(f)) throw e;
      const heic2any = await loadHeic2any();
      const jpg = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.92 });
      source = await decode(Array.isArray(jpg) ? jpg[0] : jpg);
    }
    const full = await resize(source, FULL_EDGE, 0.85);
    const thumb = await resize(source, THUMB_EDGE, 0.8);
    if (source.close) source.close();
    it.full = full.blob; it.thumb = thumb.blob; it.w = full.w; it.h = full.h;
    it.preview = URL.createObjectURL(thumb.blob);
    it.file = null; // let the browser free the big original
  }

  // Splits photos into trips: anything more than TRIP_GAP_DAYS apart starts a new group.
  async function autoGroup(items) {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const out = [];
    for (const p of sorted) {
      const g = out[out.length - 1];
      if (g && dayOf(p.date) - dayOf(g.end) <= TRIP_GAP_DAYS * DAY) { g.items.push(p); g.end = p.date; }
      else out.push({ key: rand(), items: [p], start: p.date, end: p.date });
    }
    for (const g of out) {
      const match = liveTrips.find((t) =>
        dayOf(g.start) <= dayOf(t.end) + MATCH_SLACK_DAYS * DAY && dayOf(g.end) >= dayOf(t.start) - MATCH_SLACK_DAYS * DAY);
      g.target = match ? match.id : "new";
      g.name = "";
      const withGps = g.items.find((p) => p.lat != null);
      if (withGps) g.name = await placeName(withGps.lat, withGps.lon);
    }
    return out;
  }

  // Turns GPS coordinates into a place name, e.g. "Kenya" or "Alaska".
  const placeCache = {};
  async function placeName(lat, lon) {
    const key = lat.toFixed(1) + "," + lon.toFixed(1);
    if (key in placeCache) return placeCache[key];
    let name = "";
    try {
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const j = await res.json();
      if (j.countryCode === "US") name = j.principalSubdivision || j.city || j.locality || "";
      else name = j.countryName || j.principalSubdivision || "";
      name = name.replace(/\s*\(the\)$/i, "").replace(/^the\s+/i, "").replace(/ of America$/, "");
    } catch (e) { name = ""; }
    placeCache[key] = name;
    return name;
  }

  function tripOptions(selected) {
    const sorted = [...liveTrips].sort((a, b) => b.start.localeCompare(a.start));
    return `<option value="new"${selected === "new" ? " selected" : ""}>➕ New trip</option>` +
      sorted.map((t) => `<option value="${esc(t.id)}"${t.id === selected ? " selected" : ""}>${esc(t.name)} · ${MONTHS[new Date(dayOf(t.start)).getMonth()]} ${t.start.slice(0, 4)}</option>`).join("");
  }

  function renderGroups() {
    groups = groups.filter((g) => g.items.length);
    if (!groups.length) { pending = []; return renderAdd(); }
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    view.innerHTML = `
      <h1>Check your trips</h1>
      <p class="muted">${total} photo${total > 1 ? "s" : ""}, sorted into ${groups.length} trip${groups.length > 1 ? "s" : ""} by date. Fix any names, then tap <b>Publish</b>.</p>
      ${groups.map((g, gi) => {
        const match = g.target !== "new" && liveTrips.find((t) => t.id === g.target);
        const guessed = g.items.filter((p) => p.guessedDate).length;
        return `<section class="group" data-g="${gi}">
          <div class="group-head">
            <span class="when">${rangeLabel(g.start, g.end)} · ${g.items.length} photo${g.items.length > 1 ? "s" : ""}</span>
            ${match ? `<span class="badge match">Adds to your ${esc(match.name)} trip</span>` : `<span class="badge new">New trip</span>`}
          </div>
          <div class="row">
            <label class="field" style="margin:0"><span>Put these in</span><select data-act="target">${tripOptions(g.target)}</select></label>
            ${g.target === "new" ? `<label class="field" style="margin:0"><span>Trip name</span><input type="text" data-act="name" value="${esc(g.name)}" placeholder="e.g. Kenya, Moose Pass, Alaska"></label>` : ""}
          </div>
          ${guessed ? `<p class="muted small" style="margin:10px 0 0">${guessed} photo${guessed > 1 ? "s don't" : " doesn't"} say when ${guessed > 1 ? "they were" : "it was"} taken, so the file date was used.</p>` : ""}
          <div class="thumbs">${g.items.map((p) => `<div class="thumb"><img src="${p.preview}" alt=""><button class="x" data-act="remove" data-id="${p.id}" aria-label="Remove this photo">×</button></div>`).join("")}</div>
        </section>`;
      }).join("")}
      <p><button class="btn link" id="addMore">+ Add more photos</button></p>
      <div class="sticky-actions"><div class="inner">
        <button class="btn" id="cancelAll">Cancel</button>
        <button class="btn primary" id="publish">Publish ${total} photo${total > 1 ? "s" : ""}</button>
      </div></div>
      <input type="file" id="moreInput" accept="image/*,.heic,.heif" multiple hidden>`;

    view.querySelectorAll(".group").forEach((sec) => {
      const g = groups[+sec.dataset.g];
      sec.querySelector('[data-act="target"]').addEventListener("change", (e) => { g.target = e.target.value; renderGroups(); });
      const nameInput = sec.querySelector('[data-act="name"]');
      if (nameInput) nameInput.addEventListener("input", (e) => { g.name = e.target.value; });
      sec.querySelectorAll('[data-act="remove"]').forEach((b) => b.addEventListener("click", () => {
        g.items = g.items.filter((p) => p.id !== b.dataset.id);
        pending = pending.filter((p) => p.id !== b.dataset.id);
        if (g.items.length) { g.start = g.items[0].date; g.end = g.items[g.items.length - 1].date; }
        renderGroups();
      }));
    });
    document.getElementById("cancelAll").addEventListener("click", () => {
      if (!confirm("Throw away these photos without publishing?")) return;
      pending.forEach((p) => URL.revokeObjectURL(p.preview));
      pending = []; groups = [];
      renderAdd();
    });
    const more = document.getElementById("moreInput");
    document.getElementById("addMore").addEventListener("click", () => more.click());
    more.addEventListener("change", () => { if (more.files.length) addFiles([...more.files]); });
    document.getElementById("publish").addEventListener("click", publish);
  }

  async function publish() {
    const unnamed = groups.find((g) => g.target === "new" && !g.name.trim());
    if (unnamed) {
      toast("Give each new trip a name first.", true);
      document.querySelector(`.group[data-g="${groups.indexOf(unnamed)}"] [data-act="name"]`)?.focus();
      return;
    }
    busy = true;
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    view.innerHTML = `
      <h1>Publishing…</h1>
      <p class="muted" id="pubLabel">Uploading 0 of ${total}</p>
      <div class="progress"><div id="pubBar"></div></div>
      <p class="muted small">Keep this page open until it says done.</p>`;
    const setProgress = (n) => {
      const bar = document.getElementById("pubBar"), label = document.getElementById("pubLabel");
      if (bar) bar.style.width = (n / total * 100) + "%";
      if (label) label.textContent = `Uploading ${n} of ${total}`;
    };

    const newTripKey = {}; // same new-trip name typed on two groups -> one trip
    let uploaded = 0;
    try {
      for (const g of groups) {
        if (g.target === "new") {
          const k = g.name.trim().toLowerCase();
          if (newTripKey[k]) g.mergeInto = newTripKey[k]; else newTripKey[k] = g;
        }
        for (let i = 0; i < g.items.length; i += PHOTOS_PER_SAVE) {
          const chunk = g.items.slice(i, i + PHOTOS_PER_SAVE).filter((p) => !p.saved);
          if (!chunk.length) continue;
          const files = [];
          for (const p of chunk) {
            const base = `${p.date.slice(0, 10).replace(/-/g, "")}-${p.date.slice(11, 19).replace(/:/g, "")}-${rand()}`;
            const year = p.date.slice(0, 4);
            p.path = `photos/${year}/${base}.jpg`;
            p.thumbPath = `thumbs/${year}/${base}.jpg`;
            files.push({ path: p.path, sha: await createBlob(p.full) });
            files.push({ path: p.thumbPath, sha: await createBlob(p.thumb) });
            setProgress(++uploaded - 0.5);
          }
          const owner = g.mergeInto || g;
          const label = g.target === "new" ? g.name.trim() : (liveTrips.find((t) => t.id === g.target) || {}).name || "trip";
          await save(`Add ${chunk.length} photo${chunk.length > 1 ? "s" : ""} to ${label}`, (photos) => {
            photos.trips = photos.trips || [];
            let trip = photos.trips.find((t) => t.id === (g.target !== "new" ? g.target : owner.tripId));
            if (!trip) {
              const name = (owner.name || label).trim();
              let id = `${slug(name)}-${owner.start.slice(0, 7)}`;
              while (photos.trips.some((t) => t.id === id)) id = `${slug(name)}-${owner.start.slice(0, 7)}-${rand()}`;
              trip = { id, name, start: owner.start.slice(0, 10), end: owner.end.slice(0, 10), cover: null, photos: [] };
              photos.trips.push(trip);
            }
            owner.tripId = trip.id;
            for (const p of chunk) trip.photos.push({ file: p.path, thumb: p.thumbPath, w: p.w, h: p.h, date: p.date });
            tidyTrip(trip);
            return files;
          });
          chunk.forEach((p) => { p.saved = true; });
          setProgress(uploaded);
        }
      }
    } catch (err) {
      busy = false;
      console.error(err);
      pending = pending.filter((p) => !p.saved);
      groups.forEach((g) => { g.items = g.items.filter((p) => !p.saved); });
      toast(err.message || "Something went wrong.", true);
      const left = pending.length;
      view.innerHTML = `<div class="done-box"><h1>Publishing stopped</h1>
        <p class="muted">${esc(err.message || "")}</p>
        <p class="muted">${total - left} photo${total - left === 1 ? " was" : "s were"} saved. ${left} still waiting.</p>
        <button class="btn primary" id="retry">Try again</button></div>`;
      document.getElementById("retry").addEventListener("click", renderGroups);
      return;
    }
    busy = false;
    pending.forEach((p) => URL.revokeObjectURL(p.preview));
    pending = []; groups = [];
    view.innerHTML = `<div class="done-box">
      <div class="check">✓</div>
      <h1>Published!</h1>
      <p class="muted">${total} photo${total > 1 ? "s are" : " is"} saved. Your website updates in about a minute.</p>
      <p class="row" style="max-width:420px;margin:24px auto 0">
        <a class="btn" href="../" target="_blank" rel="noopener">View website</a>
        <button class="btn primary" id="again">Add more</button>
      </p></div>`;
    document.getElementById("again").addEventListener("click", renderAdd);
  }

  function tidyTrip(trip) {
    trip.photos.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    if (trip.photos.length) {
      trip.start = trip.photos[0].date.slice(0, 10);
      trip.end = trip.photos[trip.photos.length - 1].date.slice(0, 10);
      if (!trip.cover || !trip.photos.some((p) => p.file === trip.cover)) trip.cover = trip.photos[0].file;
    }
  }

  // ---------------------------------------------------------------- manage trips
  let manageData = null;

  async function renderManage(openId) {
    view.innerHTML = `<h1>Your trips</h1><p class="muted">Loading…</p>`;
    try { manageData = await readJSON("data/photos.json"); }
    catch (err) { view.innerHTML = `<h1>Your trips</h1><p style="color:var(--danger)">${esc(err.message)}</p>`; return; }
    liveTrips = manageData.trips || [];
    if (openId && liveTrips.some((t) => t.id === openId)) return renderTripEditor(openId);
    const trips = [...liveTrips].sort((a, b) => b.start.localeCompare(a.start));
    if (!trips.length) {
      view.innerHTML = `<h1>Your trips</h1><p class="muted">No trips yet. Use <b>Add photos</b> to make your first one.</p>`;
      return;
    }
    let html = `<h1>Your trips</h1><p class="muted">Tap a trip to rename it, pick its cover photo, move or delete photos.</p>`;
    let year = null;
    html += `<div class="trip-list">`;
    for (const t of trips) {
      const y = t.start.slice(0, 4);
      if (y !== year) { year = y; html += `</div><div class="year-label">${y}</div><div class="trip-list">`; }
      const cover = t.photos.find((p) => p.file === t.cover) || t.photos[0];
      html += `<button class="trip-row" data-id="${esc(t.id)}">${cover ? imgTag(cover.thumb) : "<img alt=''>"}<div><div class="t">${esc(t.name)}</div><div class="muted small">${rangeLabel(t.start, t.end)} · ${t.photos.length} photo${t.photos.length === 1 ? "" : "s"}</div></div></button>`;
    }
    html += `</div>`;
    view.innerHTML = html;
    view.querySelectorAll(".trip-row").forEach((b) => b.addEventListener("click", () => renderTripEditor(b.dataset.id)));
  }

  async function runSave(message, change, reopenId) {
    if (busy) return;
    busy = true;
    toast("Saving…");
    try {
      const out = await save(message, change);
      manageData = out.photos;
      liveTrips = manageData.trips || [];
      toast("Saved. The website updates in about a minute.");
    } catch (err) {
      toast(err.message, true);
    } finally {
      busy = false;
    }
    if (reopenId && liveTrips.some((t) => t.id === reopenId)) renderTripEditor(reopenId);
    else renderManage();
  }

  function renderTripEditor(id) {
    const t = liveTrips.find((x) => x.id === id);
    if (!t) return renderManage();
    view.innerHTML = `
      <p><button class="btn link" id="back">← All trips</button></p>
      <h1>${esc(t.name)}</h1>
      <p class="muted">${rangeLabel(t.start, t.end)} · ${t.photos.length} photo${t.photos.length === 1 ? "" : "s"} · shows under <b>${t.start.slice(0, 4)}</b></p>
      <div class="panel">
        <label class="field"><span>Trip name</span><input type="text" id="tripName" value="${esc(t.name)}"></label>
        <button class="btn primary" id="rename">Save name</button>
      </div>
      <p class="muted small">Tap a photo for options. ★ marks the trip's cover photo.</p>
      <div class="thumbs">${t.photos.map((p, i) => `<div class="thumb${p.file === t.cover ? " selected" : ""}">${imgTag(p.thumb)}${p.file === t.cover ? `<span class="tag">★ Cover</span>` : ""}<button class="pick" data-i="${i}" aria-label="Photo options"></button></div>`).join("")}</div>
      <p style="margin-top:28px"><button class="btn danger" id="delTrip">Delete this whole trip</button></p>
      <div class="sheet" id="sheet" hidden></div>`;
    document.getElementById("back").addEventListener("click", () => renderManage());
    document.getElementById("rename").addEventListener("click", () => {
      const name = document.getElementById("tripName").value.trim();
      if (!name) return toast("The name can't be empty.", true);
      runSave(`Rename trip to ${name}`, (photos) => {
        const trip = photos.trips.find((x) => x.id === id);
        if (trip) trip.name = name;
      }, id);
    });
    document.getElementById("delTrip").addEventListener("click", () => {
      if (!confirm(`Delete "${t.name}" and all ${t.photos.length} of its photos from the website? This can't be undone here.`)) return;
      runSave(`Delete trip ${t.name}`, (photos, site) => {
        const trip = photos.trips.find((x) => x.id === id);
        if (!trip) return [];
        photos.trips = photos.trips.filter((x) => x.id !== id);
        if (trip.photos.some((p) => p.file === site.heroPhoto)) site.heroPhoto = null;
        return trip.photos.flatMap((p) => [{ path: p.file, remove: true }, { path: p.thumb, remove: true }]);
      });
    });
    view.querySelectorAll(".pick").forEach((b) => b.addEventListener("click", () => openPhotoSheet(t, t.photos[+b.dataset.i])));
  }

  function openPhotoSheet(t, p) {
    const sheet = document.getElementById("sheet");
    const others = liveTrips.filter((x) => x.id !== t.id).sort((a, b) => b.start.localeCompare(a.start));
    sheet.innerHTML = `<div class="sheet-card">
      ${imgTag(p.thumb)}
      <button class="btn" data-a="cover">★ Make this the trip's cover</button>
      <button class="btn" data-a="hero">Use as the big homepage photo</button>
      ${others.length ? `<label class="field" style="margin:0"><span>Move to another trip</span><select data-a="move"><option value="">Choose a trip…</option>${others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)} · ${o.start.slice(0, 4)}</option>`).join("")}</select></label>` : ""}
      <button class="btn danger" data-a="delete">Delete this photo</button>
      <button class="btn link" data-a="close">Cancel</button>
    </div>`;
    sheet.hidden = false;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ""; };
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    sheet.querySelector('[data-a="close"]').addEventListener("click", close);
    sheet.querySelector('[data-a="cover"]').addEventListener("click", () => {
      close();
      runSave(`New cover for ${t.name}`, (photos) => { const trip = photos.trips.find((x) => x.id === t.id); if (trip) trip.cover = p.file; }, t.id);
    });
    sheet.querySelector('[data-a="hero"]').addEventListener("click", () => {
      close();
      runSave("New homepage photo", (photos, site) => { site.heroPhoto = p.file; }, t.id);
    });
    sheet.querySelector('[data-a="move"]')?.addEventListener("change", (e) => {
      const dest = e.target.value;
      if (!dest) return;
      close();
      runSave(`Move a photo from ${t.name}`, (photos) => {
        const from = photos.trips.find((x) => x.id === t.id), to = photos.trips.find((x) => x.id === dest);
        if (!from || !to) return [];
        const entry = from.photos.find((x) => x.file === p.file);
        if (!entry) return [];
        from.photos = from.photos.filter((x) => x !== entry);
        to.photos.push(entry);
        tidyTrip(to);
        if (from.photos.length) tidyTrip(from); else photos.trips = photos.trips.filter((x) => x !== from);
        return [];
      }, t.id);
    });
    sheet.querySelector('[data-a="delete"]').addEventListener("click", () => {
      if (!confirm("Delete this photo from the website?")) return;
      close();
      runSave(`Delete a photo from ${t.name}`, (photos, site) => {
        const trip = photos.trips.find((x) => x.id === t.id);
        if (!trip || !trip.photos.some((x) => x.file === p.file)) return [];
        trip.photos = trip.photos.filter((x) => x.file !== p.file);
        if (trip.photos.length) tidyTrip(trip); else photos.trips = photos.trips.filter((x) => x !== trip);
        if (site.heroPhoto === p.file) site.heroPhoto = null;
        return [{ path: p.file, remove: true }, { path: p.thumb, remove: true }];
      }, t.id);
    });
  }

  // ---------------------------------------------------------------- settings
  async function renderSettings() {
    view.innerHTML = `<h1>Settings</h1><p class="muted">Loading…</p>`;
    let site;
    try { site = await readJSON("data/site.json"); }
    catch (err) { view.innerHTML = `<h1>Settings</h1><p style="color:var(--danger)">${esc(err.message)}</p>${disconnectHTML()}`; bindDisconnect(); return; }
    const links = (site.links || []).concat([{}, {}]).slice(0, Math.max(2, (site.links || []).length + 1));
    view.innerHTML = `
      <h1>Settings</h1>
      <form class="panel" id="siteForm">
        <h2 style="margin-bottom:14px">Website text</h2>
        <label class="field"><span>Your name (top-left of every page)</span><input type="text" name="name" value="${esc(site.name)}"></label>
        <label class="field"><span>Big headline on the homepage</span><input type="text" name="tagline" value="${esc(site.tagline)}"></label>
        <label class="field"><span>Line under the headline</span><input type="text" name="intro" value="${esc(site.intro)}"></label>
        <label class="field"><span>About page</span><textarea name="about">${esc(site.about)}</textarea></label>
        <div class="row">
          <label class="field"><span>Email for visitors (optional)</span><input type="email" name="email" value="${esc(site.email)}"></label>
          <label class="field"><span>Instagram handle (optional)</span><input type="text" name="instagram" value="${esc(site.instagram)}" placeholder="@yourname" autocapitalize="none"></label>
        </div>
        <h2 style="margin:8px 0 4px">Extra menu links (optional)</h2>
        <p class="muted small">For example a Resume link to a PDF or Google Doc. Leave blank to skip.</p>
        ${links.map((l, i) => `<div class="row">
          <label class="field"><span>Menu label</span><input type="text" name="ll${i}" value="${esc(l.label)}" placeholder="Resume"></label>
          <label class="field"><span>Link</span><input type="url" name="lu${i}" value="${esc(l.url)}" placeholder="https://…"></label>
        </div>`).join("")}
        ${site.heroPhoto ? `<p class="muted small">Homepage photo: chosen by you. <button type="button" class="btn link" id="resetHero">Go back to automatic (newest trip)</button></p>` : `<p class="muted small">Homepage photo: automatic (cover of your newest trip). To choose one, open a trip under <b>Trips</b> and tap a photo.</p>`}
        <button class="btn primary big" type="submit">Save</button>
      </form>
      ${disconnectHTML()}`;
    document.getElementById("siteForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const vals = {};
      ["name", "tagline", "intro", "about", "email", "instagram"].forEach((k) => { vals[k] = String(f.get(k) || "").trim(); });
      const newLinks = links.map((_, i) => ({ label: String(f.get("ll" + i) || "").trim(), url: String(f.get("lu" + i) || "").trim() })).filter((l) => l.label && l.url);
      settingsSave("Update site settings", (s) => { Object.assign(s, vals); s.links = newLinks; });
    });
    document.getElementById("resetHero")?.addEventListener("click", () => settingsSave("Use automatic homepage photo", (s) => { s.heroPhoto = null; }));
    bindDisconnect();
  }

  async function settingsSave(message, fn) {
    if (busy) return;
    busy = true;
    toast("Saving…");
    try { await save(message, (photos, site) => { fn(site); }); toast("Saved. The website updates in about a minute."); }
    catch (err) { toast(err.message, true); }
    finally { busy = false; }
    renderSettings();
  }

  const disconnectHTML = () => `<div class="panel"><h2>This device</h2>
    <p class="muted small">Connected to <b>${esc(cfg.owner)}/${esc(cfg.repo)}</b>. Disconnect if this isn't your own device, or to use a new key.</p>
    <button class="btn danger" id="disconnect">Disconnect</button></div>`;
  function bindDisconnect() {
    document.getElementById("disconnect")?.addEventListener("click", () => {
      if (!confirm("Disconnect this device? You'll need your key to connect again.")) return;
      cfg = { owner: cfg.owner, repo: cfg.repo, api: cfg.api };
      saveCfg();
      renderConnect();
    });
  }

  start();
})();
