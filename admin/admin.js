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
  const FULL_QUALITY = 0.8;
  const THUMB_QUALITY = 0.75;
  const SITE_LIMIT_MB = 1000; // GitHub Pages' size limit for one site
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Called when GitHub asks us to slow down; big uploads show a countdown.
  let onPause = (ms) => toast(`GitHub asked us to slow down. Continuing in ${Math.ceil(ms / 60000)} min…`);

  async function gh(method, path, body, accept) {
    let res;
    for (let tries = 0; ; tries++) {
      res = await fetch(API() + path, {
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
      if ((res.status === 403 || res.status === 429) && tries < 60) {
        const retryAfter = +res.headers.get("retry-after");
        const remaining = res.headers.get("x-ratelimit-remaining");
        const reset = +res.headers.get("x-ratelimit-reset");
        let msg = "";
        try { msg = (await res.clone().json()).message || ""; } catch (e) { /* ignore */ }
        if (retryAfter || remaining === "0" || /rate limit/i.test(msg)) {
          let wait = retryAfter ? retryAfter * 1000
            : remaining === "0" && reset ? reset * 1000 - Date.now() + 2000
            : 60000 * Math.min(5, tries + 1);
          wait = Math.max(5000, Math.min(wait, 3600000));
          onPause(wait);
          await sleep(wait);
          continue;
        }
      }
      break;
    }
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
  let repoMB = 0;     // roughly how much of the site's space is used

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
      <button class="btn big" id="fromDrive" style="margin-top:12px">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#0066da" d="M3.3 19.6l1 1.7c.2.4.5.6.8.8l3.6-6.2H1.5c0 .4.1.8.3 1.2z"/><path fill="#00ac47" d="M12 8.4L8.4 2.2c-.4.2-.6.5-.8.8L1.8 13.1c-.2.4-.3.8-.3 1.2h7.2z"/><path fill="#ea4335" d="M19.8 22.1c.4-.2.6-.5.8-.8l.4-.7 2-3.4c.2-.4.3-.8.3-1.2h-7.2l1.5 3z"/><path fill="#00832d" d="M12 8.4l3.6-6.2c-.4-.2-.8-.3-1.2-.3H9.6c-.4 0-.8.1-1.2.3z"/><path fill="#2684fc" d="M15.6 15.9H8.4l-3.6 6.2c.4.2.8.3 1.2.3h12c.4 0 .8-.1 1.2-.3z"/><path fill="#ffba00" d="M19.8 9l-3.3-5.8c-.2-.4-.5-.6-.8-.8L12 8.4l3.6 6.2h7.2c0-.4-.1-.8-.3-1.2z"/></svg>
        From a Google Drive folder
      </button>
      <button class="btn big" id="fromPhotos" style="margin-top:12px">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#fbbc04" d="M12 2a5 5 0 0 1 5 5v5H12z"/><path fill="#ea4335" d="M22 12a5 5 0 0 1-5 5h-5v-5z"/><path fill="#4285f4" d="M12 22a5 5 0 0 1-5-5v-5h5z"/><path fill="#34a853" d="M2 12a5 5 0 0 1 5-5h5v5z"/></svg>
        From Google Photos
      </button>
      <p class="muted small" style="margin-top:16px">Tip for iPhone: when picking photos, tap <b>Options</b> at the top and make sure <b>Location</b> is on. That lets this page name new trips for you.</p>`;
    const input = document.getElementById("fileInput");
    input.addEventListener("change", () => { if (input.files.length) addFiles([...input.files]); });
    document.getElementById("fromDrive").addEventListener("click", () => renderDrive());
    document.getElementById("fromPhotos").addEventListener("click", () => renderPhotos());
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

    const lock = await keepAwake();
    let done = 0;
    for (const it of items) {
      try { await prepare(it); it.status = "ready"; }
      catch (err) { console.error(err); it.status = "failed"; }
      done++;
      const bar = document.getElementById("prepBar"), label = document.getElementById("prepLabel");
      if (bar) bar.style.width = (done / items.length * 100) + "%";
      if (label) label.textContent = `${done} of ${items.length}`;
    }
    lock.release();
    await finishAdding();
  }

  async function finishAdding() {
    const failed = pending.filter((p) => p.status === "failed");
    pending = pending.filter((p) => p.status === "ready");
    try { repoMB = ((await gh("GET", repoPath())).size || 0) / 1024; } catch (e) { /* unknown */ }

    // Skip photos that are already on the site (e.g. picking the same folder again after an interruption).
    const seen = new Set();
    liveTrips.forEach((t) => t.photos.forEach((p) => { if (p.key) seen.add(p.key); }));
    let dupes = 0;
    pending = pending.filter((p) => {
      if (seen.has(p.key)) { dupes++; if (p.preview.startsWith("blob:")) URL.revokeObjectURL(p.preview); return false; }
      seen.add(p.key);
      return true;
    });

    const notes = [];
    if (failed.length) notes.push(`${failed.length} file${failed.length > 1 ? "s" : ""} couldn't be read and ${failed.length > 1 ? "were" : "was"} skipped.`);
    if (dupes) notes.push(`${dupes} photo${dupes > 1 ? "s were" : " was"} already on your site and skipped.`);
    if (notes.length) toast(notes.join(" "), !!failed.length);
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

  // MozJPEG makes files about a third smaller than the browser's own JPEG
  // encoder at the same visual quality, so many more photos fit on the site.
  let mozEncode = null;
  async function getEncoder() {
    if (mozEncode === null) {
      try { mozEncode = (await import("../vendor/jsquash-jpeg/encode.js")).default; }
      catch (e) { console.warn("MozJPEG unavailable, using browser encoder", e); mozEncode = false; }
    }
    return mozEncode;
  }

  async function resize(source, edge, quality) {
    const w = source.width, h = source.height;
    const s = Math.min(1, edge / Math.max(w, h));
    const cw = Math.round(w * s), chh = Math.round(h * s);
    const c = document.createElement("canvas");
    c.width = cw; c.height = chh;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, cw, chh);
    const enc = await getEncoder();
    if (enc) {
      try {
        const buf = await enc(ctx.getImageData(0, 0, cw, chh), { quality: Math.round(quality * 100) });
        return { blob: new Blob([buf], { type: "image/jpeg" }), w: cw, h: chh };
      } catch (e) { console.warn("MozJPEG failed, using browser encoder", e); }
    }
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

    // Fingerprint so the same photo is never added twice.
    it.key = hash(`${f.name}|${f.size}|${it.guessedDate ? "" : it.date}`);

    let source, src = f;
    try { source = await decode(f); }
    catch (e) {
      if (!isHeic(f)) throw e;
      const heic2any = await loadHeic2any();
      const jpg = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.92 });
      src = Array.isArray(jpg) ? jpg[0] : jpg;
      source = await decode(src);
    }
    // Only the small preview is made now; the full-size copy is made while
    // publishing, so hundreds of photos at once don't run the device out of memory.
    const thumb = await resize(source, THUMB_EDGE, THUMB_QUALITY);
    const s = Math.min(1, FULL_EDGE / Math.max(source.width, source.height));
    it.w = Math.round(source.width * s); it.h = Math.round(source.height * s);
    if (source.close) source.close();
    it.src = src; it.thumb = thumb.blob;
    it.preview = URL.createObjectURL(thumb.blob);
    it.file = null;
  }

  // Makes the full-size (and, for Drive photos, the thumbnail) copy at publish time.
  async function makeImages(it, blob) {
    let source;
    try { source = await decode(blob); }
    catch (e) {
      if (!isHeic({ type: blob.type || (it.drive && it.drive.mime) || "", name: (it.drive && it.drive.name) || "" })) throw e;
      const heic2any = await loadHeic2any();
      const jpg = await heic2any({ blob, toType: "image/jpeg", quality: 0.92 });
      source = await decode(Array.isArray(jpg) ? jpg[0] : jpg);
    }
    try {
      const full = await resize(source, FULL_EDGE, FULL_QUALITY);
      const thumb = it.thumb || (await resize(source, THUMB_EDGE, THUMB_QUALITY)).blob;
      return { full, thumb };
    } finally { if (source.close) source.close(); }
  }

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  // Asks the device not to dim/lock the screen during long jobs (where supported).
  async function keepAwake() {
    try {
      const lock = await navigator.wakeLock.request("screen");
      return { release: () => lock.release().catch(() => {}) };
    } catch (e) { return { release() {} }; }
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

  // ---------------------------------------------------------------- Google Drive
  // Reads a Drive folder shared as "Anyone with the link" using a Google API key
  // saved in data/site.json. The key only works from this website and only for
  // Google Drive, and it can only see files that are already shared publicly.
  const DRIVE = "https://www.googleapis.com/drive/v3/files";
  let driveKey = null;

  async function loadDriveKey() {
    if (driveKey === null) {
      try { driveKey = (await readJSON("data/site.json")).googleApiKey || ""; } catch (e) { driveKey = ""; }
    }
    return driveKey;
  }

  function folderIdFrom(link) {
    const s = String(link).trim();
    const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{20,})$/);
    return m ? m[1] : null;
  }

  async function driveJSON(url) {
    let res;
    try { res = await fetch(url); } catch (e) { throw new Error("Couldn't reach Google Drive. Check your internet connection."); }
    if (res.ok) return res.json();
    let reason = "", message = "";
    try { const j = await res.json(); reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || ""; message = (j.error && j.error.message) || ""; } catch (e) { /* ignore */ }
    if (res.status === 404) throw new Error("Couldn't open that folder. In Google Drive, share it as \"Anyone with the link\" and copy the link again.");
    if (/keyInvalid|API key not valid/i.test(reason + message)) throw new Error("Google didn't accept the Drive key. Check it under Settings → Google Drive.");
    if (/accessNotConfigured|has not been used|disabled/i.test(reason + message)) throw new Error("The Google Drive API isn't turned on for your key yet. Turn it on in Google Cloud (step 2 of the key setup), wait a minute, and try again.");
    if (/referer|referrer/i.test(reason + message)) throw new Error("Your Drive key isn't allowed on this web address. Add this site to the key's website list in Google Cloud.");
    throw new Error(`Google Drive error ${res.status}${message ? ": " + message : ""}`);
  }

  async function listDriveFolder(folderId, onFound, depth = 0) {
    const images = [];
    const fields = "nextPageToken,files(id,name,mimeType,size,thumbnailLink,imageMediaMetadata(time,location,width,height,rotation))";
    let pageToken = "";
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const url = `${DRIVE}?q=${q}&fields=${encodeURIComponent(fields)}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${encodeURIComponent(driveKey)}${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
      const j = await driveJSON(url);
      for (const f of j.files || []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          if (depth < 4) images.push(...await listDriveFolder(f.id, onFound, depth + 1));
        } else if (/^image\//.test(f.mimeType) || /\.hei[cf]$/i.test(f.name)) {
          images.push(f);
          onFound();
        }
      }
      pageToken = j.nextPageToken || "";
    } while (pageToken);
    return images;
  }

  function driveItem(f) {
    const m = f.imageMediaMetadata || {};
    const it = { id: rand() + rand(), status: "ready", drive: { id: f.id, name: f.name, mime: f.mimeType } };
    const t = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(m.time || "");
    if (t && t[1] !== "0000") { it.date = `${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}:${t[6]}`; it.guessedDate = false; }
    else { it.date = localISO(new Date()); it.guessedDate = true; }
    if (m.location && typeof m.location.latitude === "number" && (m.location.latitude || m.location.longitude)) {
      it.lat = m.location.latitude; it.lon = m.location.longitude;
    }
    let w = m.width || 3, h = m.height || 2;
    if (m.rotation === 1 || m.rotation === 3) [w, h] = [h, w];
    const s = Math.min(1, FULL_EDGE / Math.max(w, h));
    it.w = Math.round(w * s); it.h = Math.round(h * s);
    it.preview = f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, "=s400") : "";
    it.key = hash(`${f.name}|${f.size}|${it.guessedDate ? "" : it.date}`);
    return it;
  }

  async function driveDownload(d) {
    const url = `${DRIVE}/${encodeURIComponent(d.id)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(driveKey)}`;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.blob();
        if (attempt >= 4 || (res.status !== 429 && res.status < 500 && res.status !== 403)) throw new Error(`Couldn't download "${d.name}" from Google Drive (error ${res.status}).`);
      } catch (e) {
        if (attempt >= 4) throw e.message && e.message.startsWith("Couldn't") ? e : new Error(`Couldn't download "${d.name}" from Google Drive. Check your internet connection.`);
      }
      await sleep(2000 * 2 ** attempt);
    }
  }

  async function renderDrive(errMsg) {
    view.innerHTML = `<h1>From Google Drive</h1><p class="muted">Loading…</p>`;
    await loadDriveKey();
    if (!driveKey) return renderDriveKeySetup();
    view.innerHTML = `
      <p><button class="btn link" id="back">← Back</button></p>
      <h1>From Google Drive</h1>
      <div class="panel">
        <ol class="steps">
          <li>In <a href="https://drive.google.com" target="_blank" rel="noopener">Google Drive</a>, right-click the folder and choose <b>Share</b>.</li>
          <li>Under <b>General access</b>, choose <b>Anyone with the link</b>, then click <b>Copy link</b> and <b>Done</b>.</li>
          <li>Paste the link here. Photos in folders inside it are included too.</li>
        </ol>
        <form id="driveForm">
          <label class="field"><span>Folder link</span><input type="url" id="folderLink" placeholder="https://drive.google.com/drive/folders/…" required autocapitalize="none" spellcheck="false"></label>
          ${errMsg ? `<p style="color:var(--danger)">${esc(errMsg)}</p>` : ""}
          <button class="btn primary big" type="submit">Get photos</button>
        </form>
      </div>
      <p class="muted small">Photos come straight from Drive to your website, full quality, without filling up this device. Big folders upload best from a computer on Wi-Fi.</p>`;
    document.getElementById("back").addEventListener("click", renderAdd);
    document.getElementById("driveForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = folderIdFrom(document.getElementById("folderLink").value);
      if (!id) return renderDrive("That doesn't look like a Google Drive folder link. It should contain /folders/ followed by letters and numbers.");
      addDriveFolder(id);
    });
  }

  function renderDriveKeySetup(errMsg) {
    const here = location.origin;
    view.innerHTML = `
      <p><button class="btn link" id="back">← Back</button></p>
      <h1>Connect Google Drive</h1>
      <p class="muted">One-time setup, about 5 minutes. It's free, and you won't need a credit card.</p>
      <div class="panel">
        <ol class="steps">
          <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud → New project</a> and sign in with your Google account. Name it <code>Brandon DeLay site</code> and click <b>Create</b>. Accept the terms if asked.</li>
          <li>Open <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Google Drive API</a>. Make sure your new project is selected at the top, then click <b>Enable</b>.</li>
          <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credentials</a>, click <b>+ Create credentials</b> → <b>API key</b>, and copy the key it shows (it starts with <code>AIza</code>).</li>
          <li>Recommended: click <b>Edit API key</b>. Under <b>Application restrictions</b> pick <b>Websites</b> and add <code>${esc(here)}/*</code>, <code>https://brandondelay.com/*</code> and <code>https://www.brandondelay.com/*</code>. Under <b>API restrictions</b> pick <b>Restrict key</b> → <b>Google Drive API</b>. Click <b>Save</b>.</li>
        </ol>
        <form id="keyForm">
          <label class="field"><span>Paste the key</span><input type="text" id="apiKey" placeholder="AIza…" required autocapitalize="none" spellcheck="false"></label>
          ${errMsg ? `<p style="color:var(--danger)">${esc(errMsg)}</p>` : ""}
          <button class="btn primary big" type="submit">Save key</button>
        </form>
      </div>
      <p class="muted small">The key is saved with your website so every phone and computer can use it. It can only read Drive folders you've shared with "Anyone with the link", and only from your website.</p>`;
    document.getElementById("back").addEventListener("click", renderAdd);
    document.getElementById("keyForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = document.getElementById("apiKey").value.trim();
      if (!/^AIza[\w-]{30,}$/.test(key)) return renderDriveKeySetup("That doesn't look like a Google API key. It should start with AIza.");
      const btn = e.target.querySelector("button");
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        await save("Connect Google Drive", (photos, site) => { site.googleApiKey = key; });
        driveKey = key;
        toast("Google Drive connected!");
        renderDrive();
      } catch (err) { renderDriveKeySetup(err.message); }
    });
  }

  async function addDriveFolder(folderId) {
    busy = true;
    view.innerHTML = `
      <h1>Looking through your folder…</h1>
      <p class="muted" id="prepLabel">Found 0 photos</p>
      <div class="progress"><div id="prepBar" style="width:30%"></div></div>`;
    let found = 0;
    try {
      try { liveTrips = (await readJSON("data/photos.json")).trips || []; } catch (e) { liveTrips = []; }
      const files = await listDriveFolder(folderId, () => {
        found++;
        const label = document.getElementById("prepLabel");
        if (label && found % 25 === 0) label.textContent = `Found ${found} photos`;
      });
      if (!files.length) { busy = false; return renderDrive("No photos found in that folder."); }
      pending.push(...files.map(driveItem));
    } catch (err) {
      busy = false;
      return renderDrive(err.message);
    }
    await finishAdding();
  }

  // ---------------------------------------------------------------- Google Photos
  // Uses Google's Photos Picker: you choose photos inside Google Photos and this
  // page fetches web-size copies straight from Google, so nothing is stored on
  // your device. Needs an OAuth client ID (saved in data/site.json; it's public
  // by design and only works from this website).
  const PICKER = "https://photospicker.googleapis.com/v1";
  const GP_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
  let gpClientId = null, gpToken = null, gpTokenExpires = 0, gpSessionId = null, gpPollRun = 0;

  async function loadGpClientId() {
    if (gpClientId === null) {
      try { gpClientId = (await readJSON("data/site.json")).googleClientId || ""; } catch (e) { gpClientId = ""; }
    }
    return gpClientId;
  }

  let gisLoader = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisLoader) gisLoader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = resolve;
      s.onerror = () => { gisLoader = null; reject(new Error("Couldn't load Google sign-in. Check your internet connection.")); };
      document.head.appendChild(s);
    });
    return gisLoader;
  }

  const gpTokenValid = () => gpToken && Date.now() < gpTokenExpires;

  // Must be called straight from a tap/click so the Google sign-in window isn't blocked.
  function signInGooglePhotos() {
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: gpClientId,
        scope: GP_SCOPE,
        callback: (r) => {
          if (r.error) return reject(new Error(r.error === "access_denied" ? "Google Photos access wasn't allowed. Try again and tick the box to allow access." : "Google sign-in didn't finish: " + r.error));
          gpToken = r.access_token;
          gpTokenExpires = Date.now() + (Number(r.expires_in || 3600) - 120) * 1000;
          resolve();
        },
        error_callback: (e) => reject(new Error(
          e && e.type === "popup_failed_to_open" ? "Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again."
            : e && e.type === "popup_closed" ? "The Google sign-in window was closed before finishing."
              : "Google sign-in didn't finish.")),
      });
      client.requestAccessToken();
    });
  }

  function reauthError() {
    const err = new Error("Google Photos needs you to sign in again to keep going (Google signs you out after an hour).");
    err.reauth = true;
    return err;
  }

  async function gpFetch(url, opts = {}) {
    if (!gpTokenValid()) throw reauthError();
    let res;
    try { res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + gpToken } }); }
    catch (e) { throw new Error("Couldn't reach Google Photos. Check your internet connection."); }
    if (res.status === 401) throw reauthError();
    return res;
  }

  async function gpJSON(url, opts) {
    const res = await gpFetch(url, opts);
    if (res.ok) return res.status === 204 ? {} : res.json();
    let message = "";
    try { message = ((await res.json()).error || {}).message || ""; } catch (e) { /* ignore */ }
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) throw new Error("The Photos Picker API isn't turned on in Google Cloud yet (setup step 2). Turn it on, wait a minute, and try again.");
    if (res.status === 403) throw new Error("Google Photos said no access: " + (message || "permission denied") + ". Make sure your Gmail is added as a test user (setup step 4).");
    const err = new Error(`Google Photos error ${res.status}${message ? ": " + message : ""}`);
    err.status = res.status;
    throw err;
  }

  const durationMs = (s, fallback) => { const m = /^([\d.]+)s$/.exec(s || ""); return m ? Number(m[1]) * 1000 : fallback; };

  async function gpListAll(sessionId) {
    const out = [];
    let pageToken = "";
    do {
      const j = await gpJSON(`${PICKER}/mediaItems?sessionId=${encodeURIComponent(sessionId)}&pageSize=100${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`);
      out.push(...(j.mediaItems || []));
      pageToken = j.nextPageToken || "";
    } while (pageToken);
    return out;
  }

  function gpItem(m) {
    const f = m.mediaFile || {};
    const meta = f.mediaFileMetadata || {};
    const it = { id: rand() + rand(), status: "ready", gp: { id: m.id, baseUrl: f.baseUrl, name: f.filename || "photo", mime: f.mimeType || "" } };
    const when = new Date(m.createTime);
    if (m.createTime && !isNaN(when)) { it.date = localISO(when); it.guessedDate = false; }
    else { it.date = localISO(new Date()); it.guessedDate = true; }
    let w = Number(meta.width) || 3, h = Number(meta.height) || 2;
    const s = Math.min(1, FULL_EDGE / Math.max(w, h));
    it.w = Math.round(w * s); it.h = Math.round(h * s);
    it.preview = "";
    it.key = hash(`gp|${f.filename}|${m.createTime}`);
    return it;
  }

  async function gpDownload(it, size) {
    const url = `${it.gp.baseUrl}=w${size}-h${size}`;
    for (let attempt = 0; ; attempt++) {
      const res = await gpFetch(url);
      if (res.ok) return res.blob();
      if (res.status === 403) throw reauthError(); // the photo links expire after an hour too
      if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`Couldn't download "${it.gp.name}" from Google Photos (error ${res.status}).`);
      await sleep(2000 * 2 ** attempt);
    }
  }

  // After signing in again, ask Google for fresh photo links for the same selection.
  async function gpRefreshLinks() {
    if (!gpSessionId) throw new Error("Please pick the photos again. Ones already uploaded will be skipped.");
    let fresh;
    try { fresh = await gpListAll(gpSessionId); }
    catch (e) {
      if (e.reauth) throw e;
      throw new Error("Google's photo selection expired. Please pick the same photos again. Ones already uploaded will be skipped.");
    }
    const byId = new Map(fresh.map((m) => [m.id, m.mediaFile && m.mediaFile.baseUrl]));
    pending.forEach((p) => { if (p.gp && byId.get(p.gp.id)) p.gp.baseUrl = byId.get(p.gp.id); p.dl = null; });
  }

  async function loadPreviews(items, onProgress) {
    let i = 0, done = 0, ok = 0, firstErr = null;
    const worker = async () => {
      while (i < items.length) {
        const it = items[i++];
        try { it.preview = URL.createObjectURL(await gpDownload(it, 300)); ok++; }
        catch (e) { if (e.reauth) throw e; firstErr = firstErr || e; }
        onProgress(++done);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (!ok && firstErr) throw new Error("Google Photos didn't let this page download your photos. " + firstErr.message);
  }

  async function renderPhotos(errMsg) {
    gpPollRun++;
    view.innerHTML = `<h1>From Google Photos</h1><p class="muted">Loading…</p>`;
    await loadGpClientId();
    if (!gpClientId) return renderPhotosSetup();
    try { await loadGis(); }
    catch (e) { view.innerHTML = `<h1>From Google Photos</h1><p style="color:var(--danger)">${esc(e.message)}</p>`; return; }
    view.innerHTML = `
      <p><button class="btn link" id="back">← Back</button></p>
      <h1>From Google Photos</h1>
      <div class="panel">
        <ol class="steps">
          <li>Tap <b>Choose from Google Photos</b>${gpTokenValid() ? "" : " and sign in with Google. It may say <b>Google hasn't verified this app</b>. That's expected for your own app: tap <b>Continue</b>"}.</li>
          <li>Google Photos opens in a new tab. Pick photos. To grab a whole album, open <b>Albums</b>, open the album, and select its photos (up to 2,000 at a time).</li>
          <li>Tap <b>Done</b> in Google Photos, then come back to this tab.</li>
        </ol>
        ${errMsg ? `<p style="color:var(--danger)">${esc(errMsg)}</p>` : ""}
        <button class="btn primary big" id="gpStart">Choose from Google Photos</button>
      </div>
      <p class="muted small">Photos go straight from Google Photos to your website. Nothing is saved on this device. Videos are skipped.</p>`;
    document.getElementById("back").addEventListener("click", renderAdd);
    document.getElementById("gpStart").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (!gpTokenValid()) await signInGooglePhotos();
        btn.textContent = "Opening Google Photos…";
        const session = await gpJSON(`${PICKER}/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pickingConfig: { maxItemCount: "2000" } }) });
        gpSessionId = session.id;
        renderPicking(session);
      } catch (err) {
        renderPhotos(err.message);
      }
    });
  }

  function renderPicking(session) {
    const run = ++gpPollRun;
    const link = session.pickerUri + (/Mobi|Android/i.test(navigator.userAgent) ? "" : "/autoclose");
    view.innerHTML = `
      <h1>Pick your photos</h1>
      <div class="panel">
        <p>Open Google Photos, select the photos you want, then tap <b>Done</b> and come back here.</p>
        <a class="btn primary big" id="gpOpen" href="${esc(link)}" target="_blank" rel="noopener">Open Google Photos</a>
        <p class="muted small" id="gpWait" style="margin-top:14px">Waiting for your selection…</p>
      </div>
      <p><button class="btn link" id="gpCancel">Cancel</button></p>`;
    document.getElementById("gpCancel").addEventListener("click", () => { gpPollRun++; renderAdd(); });
    const interval = Math.max(2000, durationMs(session.pollingConfig && session.pollingConfig.pollInterval, 4000));
    const deadline = Date.now() + durationMs(session.pollingConfig && session.pollingConfig.timeoutIn, 30 * 60000);
    (async () => {
      while (run === gpPollRun) {
        await sleep(interval);
        if (run !== gpPollRun) return;
        if (Date.now() > deadline) return renderPhotos("Google Photos stopped waiting. Please try again.");
        try {
          const s = await gpJSON(`${PICKER}/sessions/${encodeURIComponent(session.id)}`);
          if (s.mediaItemsSet) { if (run === gpPollRun) addGooglePhotos(session.id); return; }
        } catch (err) {
          if (err.reauth) return renderPhotos("Google signed you out. Please try again.");
          /* network blip: keep waiting */
        }
      }
    })();
  }

  async function addGooglePhotos(sessionId) {
    busy = true;
    view.innerHTML = `
      <h1>Getting your photos ready…</h1>
      <p class="muted" id="prepLabel">Reading your selection…</p>
      <div class="progress"><div id="prepBar"></div></div>
      <p class="muted small">Loading small previews from Google Photos. Keep this page open.</p>`;
    try {
      try { liveTrips = (await readJSON("data/photos.json")).trips || []; } catch (e) { liveTrips = []; }
      const media = await gpListAll(sessionId);
      const photos = media.filter((m) => m.type !== "VIDEO" && !/^video\//.test((m.mediaFile || {}).mimeType || ""));
      const skippedVideos = media.length - photos.length;
      if (!photos.length) { busy = false; return renderPhotos(skippedVideos ? "Only videos were picked. This site shows photos." : "No photos were picked."); }
      const items = photos.map(gpItem);
      // Skip already-published photos before loading their previews.
      const seen = new Set();
      liveTrips.forEach((t) => t.photos.forEach((p) => { if (p.key) seen.add(p.key); }));
      const fresh = items.filter((it) => !seen.has(it.key));
      await loadPreviews(fresh, (n) => {
        const bar = document.getElementById("prepBar"), label = document.getElementById("prepLabel");
        if (bar) bar.style.width = (n / fresh.length * 100) + "%";
        if (label) label.textContent = `${n} of ${fresh.length}`;
      });
      pending.push(...items);
      if (skippedVideos) toast(`${skippedVideos} video${skippedVideos > 1 ? "s were" : " was"} skipped.`);
    } catch (err) {
      busy = false;
      return renderPhotos(err.message);
    }
    await finishAdding();
  }

  function renderPhotosSetup(errMsg) {
    const here = location.origin;
    view.innerHTML = `
      <p><button class="btn link" id="back">← Back</button></p>
      <h1>Connect Google Photos</h1>
      <p class="muted">One-time setup on a computer, about 10–15 minutes. It's free. Do these in Google Cloud, using the same project as before if you made one.</p>
      <div class="panel">
        <ol class="steps">
          <li><b>Pick your project.</b> Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud</a> and check that the project name at the top is your site's project (e.g. <code>Brandon DeLay site</code>). No project yet? <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Create one</a>.</li>
          <li><b>Turn on the photo picker.</b> Open <a href="https://console.cloud.google.com/apis/library/photospicker.googleapis.com" target="_blank" rel="noopener">Photos Picker API</a> and click <b>Enable</b>.</li>
          <li><b>Set up the sign-in screen.</b> Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a> and click <b>Get started</b>. App name: <code>Brandon DeLay site</code>. Support email: your Gmail. Audience: <b>External</b>. Contact email: your Gmail. Agree, then <b>Create</b>.</li>
          <li><b>Add yourself as a tester.</b> Open <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener">Audience</a>. Under <b>Test users</b> click <b>+ Add users</b>, type your Gmail address, and <b>Save</b>.</li>
          <li><b>Create the client.</b> Open <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener">Clients</a> → <b>+ Create client</b>. Application type: <b>Web application</b>. Name: <code>Photo uploader</code>. Under <b>Authorized JavaScript origins</b> click <b>+ Add URI</b> three times and enter <code>${esc(here)}</code>, <code>https://brandondelay.com</code> and <code>https://www.brandondelay.com</code> (no slash at the end). Leave redirect URIs empty. Click <b>Create</b>.</li>
          <li>Copy the <b>Client ID</b> (it ends in <code>.apps.googleusercontent.com</code>) and paste it below. You don't need the client secret.</li>
        </ol>
        <form id="clientForm">
          <label class="field"><span>Client ID</span><input type="text" id="clientId" placeholder="1234…apps.googleusercontent.com" required autocapitalize="none" spellcheck="false"></label>
          ${errMsg ? `<p style="color:var(--danger)">${esc(errMsg)}</p>` : ""}
          <button class="btn primary big" type="submit">Save</button>
        </form>
      </div>
      <p class="muted small">The client ID is saved with your website so every device can use it. It only works from your website, and only you (as a test user) can sign in with it.</p>`;
    document.getElementById("back").addEventListener("click", renderAdd);
    document.getElementById("clientForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("clientId").value.trim();
      if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) return renderPhotosSetup("That doesn't look like a client ID. It should end in .apps.googleusercontent.com.");
      const btn = e.target.querySelector("button");
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        await save("Connect Google Photos", (photos, site) => { site.googleClientId = id; });
        gpClientId = id;
        toast("Google Photos connected!");
        renderPhotos();
      } catch (err) { renderPhotosSetup(err.message); }
    });
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
      ${storageNote(total)}
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
          ${guessed ? `<label class="field" style="margin:12px 0 0"><span>${guessed} photo${guessed > 1 ? "s don't" : " doesn't"} say when ${guessed > 1 ? "they were" : "it was"} taken. When was this trip?</span><input type="date" data-act="date" value="${esc(g.manualDate || "")}"></label>` : ""}
          <div class="thumbs">${g.items.map((p) => `<div class="thumb"><img src="${esc(p.preview)}" alt="" loading="lazy" referrerpolicy="no-referrer"><button class="x" data-act="remove" data-id="${p.id}" aria-label="Remove this photo">×</button></div>`).join("")}</div>
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
      sec.querySelector('[data-act="date"]')?.addEventListener("change", (e) => {
        const day = e.target.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
        g.manualDate = day;
        // Keep the order the photos were picked in by spacing them a second apart.
        g.items.filter((p) => p.guessedDate).forEach((p, i) => { p.date = `${day}T12:${pad(Math.floor(i / 60) % 60)}:${pad(i % 60)}`; });
        g.items.sort((a, b) => a.date.localeCompare(b.date));
        g.start = g.items[0].date; g.end = g.items[g.items.length - 1].date;
        const match = liveTrips.find((t) =>
          dayOf(g.start) <= dayOf(t.end) + MATCH_SLACK_DAYS * DAY && dayOf(g.end) >= dayOf(t.start) - MATCH_SLACK_DAYS * DAY);
        g.target = match ? match.id : "new";
        renderGroups();
      });
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

  // Starts downloading a Drive/Google Photos original (null for photos already on this device).
  function fetchRemote(p) {
    const dl = p.drive ? driveDownload(p.drive) : p.gp ? gpDownload(p, FULL_EDGE) : null;
    if (dl) dl.catch(() => {}); // errors are handled where it's awaited
    return dl;
  }

  async function publish() {
    const undated = groups.find((g) => g.items.every((p) => p.guessedDate) && !g.manualDate);
    if (undated) {
      toast("Pick the date for photos that don't have one, so they land in the right year.", true);
      document.querySelector(`.group[data-g="${groups.indexOf(undated)}"] [data-act="date"]`)?.focus();
      return;
    }
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
      <p class="muted small">Keep this page open until it says done.${total > 100 ? " A big batch like this can take a while, and GitHub may ask for a few short breaks along the way. It continues on its own." : ""}</p>`;
    const setProgress = (n) => {
      const bar = document.getElementById("pubBar"), label = document.getElementById("pubLabel");
      if (bar) bar.style.width = (n / total * 100) + "%";
      if (label) label.textContent = `Uploading ${Math.floor(n)} of ${total}`;
    };
    const defaultPause = onPause;
    onPause = (ms) => {
      const label = document.getElementById("pubLabel");
      const until = new Date(Date.now() + ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (label) label.textContent = `Uploaded ${uploaded} of ${total}. GitHub asked for a short break, continuing around ${until}. Keep this page open.`;
    };
    const lock = await keepAwake();

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
          for (let j = 0; j < chunk.length; j++) {
            const p = chunk[j];
            // Start downloading the next Drive photo while this one is processed.
            const next = chunk[j + 1] || g.items[i + PHOTOS_PER_SAVE];
            if (next && !next.dl) next.dl = fetchRemote(next);
            if (!p.dl) p.dl = fetchRemote(p);
            const blob = p.dl ? await p.dl : p.src;
            p.dl = null;
            const base = `${p.date.slice(0, 10).replace(/-/g, "")}-${p.date.slice(11, 19).replace(/:/g, "")}-${rand()}`;
            const year = p.date.slice(0, 4);
            p.path = `photos/${year}/${base}.jpg`;
            p.thumbPath = `thumbs/${year}/${base}.jpg`;
            const { full, thumb } = await makeImages(p, blob);
            p.w = full.w; p.h = full.h;
            files.push({ path: p.path, sha: await createBlob(full.blob) });
            files.push({ path: p.thumbPath, sha: await createBlob(thumb) });
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
            for (const p of chunk) trip.photos.push({ file: p.path, thumb: p.thumbPath, w: p.w, h: p.h, date: p.date, key: p.key });
            tidyTrip(trip);
            return files;
          });
          chunk.forEach((p) => { p.saved = true; p.src = null; });
          setProgress(uploaded);
        }
      }
    } catch (err) {
      busy = false;
      onPause = defaultPause;
      lock.release();
      console.error(err);
      pending = pending.filter((p) => !p.saved);
      pending.forEach((p) => { p.dl = null; });
      groups.forEach((g) => { g.items = g.items.filter((p) => !p.saved); });
      const left = pending.length;
      if (err.reauth) {
        view.innerHTML = `<div class="done-box"><h1>Quick sign-in needed</h1>
          <p class="muted">${esc(err.message)}</p>
          <p class="muted">${total - left} photo${total - left === 1 ? " was" : "s were"} saved. ${left} still to go.</p>
          <p id="reauthErr" style="color:var(--danger)"></p>
          <button class="btn primary big" id="reauth" style="max-width:420px">Sign in and keep going</button></div>`;
        document.getElementById("reauth").addEventListener("click", async () => {
          try { await signInGooglePhotos(); await gpRefreshLinks(); publish(); }
          catch (e) { document.getElementById("reauthErr").textContent = e.message; }
        });
        return;
      }
      toast(err.message || "Something went wrong.", true);
      view.innerHTML = `<div class="done-box"><h1>Publishing stopped</h1>
        <p class="muted">${esc(err.message || "")}</p>
        <p class="muted">${total - left} photo${total - left === 1 ? " was" : "s were"} saved. ${left} still waiting.</p>
        <button class="btn primary" id="retry">Try again</button></div>`;
      document.getElementById("retry").addEventListener("click", renderGroups);
      return;
    }
    busy = false;
    onPause = defaultPause;
    lock.release();
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

  // About 0.5 MB per photo (full size + thumbnail) after compression.
  const MB_PER_PHOTO = 0.5;
  function storageNote(adding) {
    if (!repoMB) return "";
    const after = repoMB + adding * MB_PER_PHOTO;
    if (after < SITE_LIMIT_MB * 0.8) return "";
    const roomFor = Math.max(0, Math.floor((SITE_LIMIT_MB * 0.95 - repoMB) / MB_PER_PHOTO));
    return `<div class="panel" style="border-color:var(--accent)"><b>Your site is getting full.</b>
      <p class="muted small" style="margin:6px 0 0">${after > SITE_LIMIT_MB * 0.95
        ? `There's room for about ${roomFor} more photos, and this batch has ${adding}. Remove some from this batch, or ask Claude to add extra photo storage (it's free).`
        : `After this batch about ${Math.round(after / SITE_LIMIT_MB * 100)}% of your site's space is used. Ask Claude to add extra photo storage when you get close (it's free).`}</p></div>`;
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
      <div class="panel"><h2>Space used</h2><p class="muted small" id="space">Checking…</p></div>
      <div class="panel"><h2>Google Photos</h2>
        <p class="muted small">${site.googleClientId ? "Connected. Use <b>Add photos → From Google Photos</b>." : "Not connected yet. Use <b>Add photos → From Google Photos</b> to set it up."}</p>
        ${site.googleClientId ? `<button type="button" class="btn" id="changeClient">Change client ID</button>` : ""}</div>
      <div class="panel"><h2>Google Drive</h2>
        <p class="muted small">${site.googleApiKey ? "Connected. You can add photos from shared Drive folders." : "Not connected yet. Use <b>Add photos → From a Google Drive folder</b> to set it up."}</p>
        ${site.googleApiKey ? `<button type="button" class="btn" id="changeKey">Change Drive key</button>` : ""}</div>
      ${disconnectHTML()}`;
    gh("GET", repoPath()).then((r) => {
      const mb = (r.size || 0) / 1024;
      const el = document.getElementById("space");
      if (el) el.textContent = `About ${Math.round(mb)} MB of ${SITE_LIMIT_MB.toLocaleString()} MB (${Math.round(mb / SITE_LIMIT_MB * 100)}%). Room for roughly ${Math.max(0, Math.floor((SITE_LIMIT_MB * 0.95 - mb) / MB_PER_PHOTO)).toLocaleString()} more photos.`;
    }).catch(() => {});
    document.getElementById("changeClient")?.addEventListener("click", () => { tab = "add"; tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "add")); renderPhotosSetup(); });
    document.getElementById("changeKey")?.addEventListener("click", () => { tab = "add"; tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "add")); renderDriveKeySetup(); });
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
