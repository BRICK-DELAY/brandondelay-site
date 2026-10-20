// Shared by the workout page (/workouts) and the posting form (/workouts/post).
//
// workouts/plan.json holds a short queue of workouts per person. The page shows
// each person's oldest unfinished workout; marking it complete moves them on.
// Saving goes through the GitHub API with a key that has "Contents: Read and
// write" on the site's repository, remembered on each device.

window.Workouts = (function () {
  "use strict";

  const REPO = "BRICK-DELAY/brandondelay-site";
  const PATH = "workouts/plan.json";
  const BRANCH = "main";
  const KEY_STORE = "workout-github-key";
  const MAX_PENDING = 2;     // unfinished workouts a person can have queued
  const KEEP_DONE = 20;      // finished workouts kept per person (older ones live in git history)
  const PEOPLE = { brandon: "Brandon", cecelia: "Cecelia", jose: "Jose" };

  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workout";

  function getKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } }
  function setKey(k) { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (e) { /* private mode */ } }

  const b64encode = (str) => { let bin = ""; new TextEncoder().encode(str).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  function emptyPlan() {
    const people = {};
    Object.entries(PEOPLE).forEach(([id, name]) => { people[id] = { name, queue: [] }; });
    return { people };
  }
  function normalise(plan) {
    plan = plan && plan.people ? plan : emptyPlan();
    Object.entries(PEOPLE).forEach(([id, name]) => {
      if (!plan.people[id]) plan.people[id] = { name, queue: [] };
      if (!Array.isArray(plan.people[id].queue)) plan.people[id].queue = [];
    });
    return plan;
  }

  // The public copy (no key needed), for showing workouts.
  async function loadPublic() {
    const res = await fetch("/workouts/plan.json?t=" + Date.now(), { cache: "no-store" });
    if (res.status === 404) return emptyPlan();
    if (!res.ok) throw new Error("Couldn't load workouts (" + res.status + ")");
    return normalise(await res.json());
  }

  async function api(method, path, key, body) {
    const res = await fetch("https://api.github.com/repos/" + REPO + path, {
      method,
      headers: { Authorization: "Bearer " + key, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (res.status === 404 && method === "GET") return null;
    if (!res.ok) {
      let msg = ""; try { msg = (await res.json()).message || ""; } catch (e) { /* ignore */ }
      const err = new Error(
        res.status === 401 ? "GitHub didn't accept the key. It may have expired; paste a new one."
          : res.status === 403 || res.status === 404 ? "This key can't save to the site. It needs \"Contents: Read and write\" on brandondelay-site."
            : res.status === 409 ? "conflict" : `GitHub error ${res.status}${msg ? ": " + msg : ""}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // Read-modify-write plan.json. `change(plan)` edits the plan and returns a
  // result; returning { skip: true, ... } saves nothing. Retries once if
  // someone else saved at the same moment.
  async function update(key, message, change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await api("GET", `/contents/${PATH}?ref=${BRANCH}`, key);
      const plan = normalise(cur ? JSON.parse(b64decode(cur.content)) : null);
      const result = change(plan) || {};
      if (result.skip) return { plan, ...result };
      try {
        await api("PUT", `/contents/${PATH}`, key, {
          message, branch: BRANCH, content: b64encode(JSON.stringify(plan, null, 2) + "\n"), ...(cur ? { sha: cur.sha } : {}),
        });
        return { plan, ...result };
      } catch (e) {
        if (!(e.status === 409 || e.status === 422) || attempt === 2) throw e;
      }
    }
  }

  const pending = (person) => person.queue.filter((w) => !w.completed);
  const current = (person) => pending(person)[0] || null;
  function prune(person) {
    const done = person.queue.filter((w) => w.completed);
    const drop = new Set(done.slice(0, Math.max(0, done.length - KEEP_DONE)));
    person.queue = person.queue.filter((w) => !drop.has(w));
  }

  // Plain text -> structured workout. "## Section" (or "Section:") starts a
  // section; "- item" lines are exercises ("Name: details"); other lines are notes.
  function fromText(text) {
    const t = String(text || "").trim();
    if (t.startsWith("{")) return JSON.parse(t);
    const sections = [], notes = [];
    let cur = null;
    t.split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (!s) return;
      const h = /^#{1,3}\s+(.*)$/.exec(s) || /^([A-Za-z][^:]{0,40}):$/.exec(s);
      if (h) { cur = { name: h[1].trim(), items: [] }; sections.push(cur); return; }
      const b = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(s);
      if (b) {
        if (!cur) { cur = { name: "Workout", items: [] }; sections.push(cur); }
        const m = /^(.*?)(?::\s+|\s+[—–-]\s+)(.*)$/.exec(b[1]);
        cur.items.push(m ? { exercise: m[1].trim(), detail: m[2].trim() } : { exercise: b[1].trim() });
        return;
      }
      if (cur && cur.items.length) { const it = cur.items[cur.items.length - 1]; it.notes = ((it.notes || "") + " " + s).trim(); }
      else if (cur) cur.notes = ((cur.notes || "") + " " + s).trim();
      else notes.push(s);
    });
    const out = {};
    if (sections.length) out.sections = sections; else out.markdown = t;
    if (notes.length) out.notes = notes.join("\n");
    return out;
  }

  // Adds a workout to the end of someone's queue (unless they already have MAX_PENDING waiting).
  function addWorkout(key, who, workout) {
    const name = PEOPLE[who];
    return update(key, `Workout for ${name}: ${workout.title} (${workout.date})`, (plan) => {
      const person = plan.people[who];
      const waiting = pending(person);
      if (waiting.length >= MAX_PENDING) return { skip: true, reason: "full", waiting };
      const w = { id: `${workout.date}-${slug(workout.title)}-${Math.random().toString(36).slice(2, 6)}`, ...workout, completed: null };
      person.queue.push(w);
      prune(person);
      return { added: w, waiting: pending(person) };
    });
  }

  // How a workout felt, for the agent to read: { rating: "easy" | "right" | "hard", note }.
  const RATINGS = { easy: "Too easy", right: "Just right", hard: "Too hard" };
  function cleanFeedback(f) {
    if (!f) return null;
    const out = {};
    if (f.rating in RATINGS) out.rating = f.rating;
    const note = String(f.note || "").trim().slice(0, 500);
    if (note) out.note = note;
    return Object.keys(out).length ? out : null;
  }

  // Marks a workout finished (with optional feedback) or not finished.
  function setCompleted(key, who, id, done, feedback) {
    return update(key, `${PEOPLE[who]} ${done ? "finished" : "un-finished"} a workout`, (plan) => {
      const w = plan.people[who].queue.find((x) => x.id === id);
      if (!w) return { skip: true, reason: "missing" };
      w.completed = done ? today() : null;
      const fb = cleanFeedback(feedback);
      if (done && fb) w.feedback = fb;
      // A lasting record of finished workouts for the calendar, totals and streaks
      // (the queue only keeps recent workouts).
      const person = plan.people[who];
      person.history = (person.history || []).filter((h) => h.id !== id);
      if (done) person.history.push({ id, date: w.completed, planned: w.date, title: w.title, reps: countReps(w), ...(w.feedback ? { feedback: w.feedback } : {}) });
      prune(person);
      return {};
    });
  }

  // Adds or changes the feedback on a finished workout.
  function setFeedback(key, who, id, feedback) {
    return update(key, `${PEOPLE[who]} rated a workout`, (plan) => {
      const person = plan.people[who], fb = cleanFeedback(feedback);
      const w = person.queue.find((x) => x.id === id), h = (person.history || []).find((x) => x.id === id);
      if (!w && !h) return { skip: true, reason: "missing" };
      [w, h].forEach((x) => { if (!x) return; if (fb) x.feedback = fb; else delete x.feedback; });
      return {};
    });
  }

  // Reps in a workout, read from each exercise's sets and reps: "3 x 8-10" is 24
  // (the low end of a range), "2 x 10 / side" is 40, "10 reps" is 10, and a
  // section with "rounds" multiplies its exercises. Timed or distance work
  // ("45 sec", "3 mi") adds no reps.
  function itemReps(it) {
    const perSide = (rest) => (/^\s*(?:reps?\s*)?(?:\/|per|each)\s*(?:side|leg|arm)/i.test(rest) ? 2 : 1);
    const timed = (rest) => /^\s*(?:s|sec|secs|seconds?|min|mins|minutes?|m|mi|miles?|km|yd|yards?|meters?|cal|steps?)\b/i.test(rest);
    if (it.reps != null && !it.duration) {
      const r = String(it.reps), m = /^\s*(\d+)(?:\s*[-–]\s*\d+)?(.*)$/.exec(r);
      if (m && !timed(m[2])) {
        const sets = Number(it.sets) > 0 ? Number(it.sets) : 1;
        return sets * Number(m[1]) * Math.max(perSide(m[2]), perSide(String(it.detail || "")));
      }
    }
    const d = String(it.detail || "");
    let m = /^\s*(\d+)\s*[x×]\s*(\d+)(?:\s*[-–]\s*\d+)?(.*)$/i.exec(d);
    if (m) return timed(m[3]) ? 0 : Number(m[1]) * Number(m[2]) * perSide(m[3]);
    m = /^\s*(\d+)(?:\s*[-–]\s*\d+)?(\s*(?:reps?\b|(?:\/|per|each)\s*(?:side|leg|arm)).*)$/i.exec(d);
    if (m) return Number(m[1]) * perSide(m[2]);
    return 0;
  }
  function countReps(w) {
    return (w.sections || []).reduce((sum, sec) => {
      const rounds = Number(sec.rounds) > 0 ? Number(sec.rounds) : 1;
      return sum + rounds * (sec.items || []).reduce((n, it) => n + itemReps(it), 0);
    }, 0);
  }

  // Every finished workout, oldest first: { id, date, planned, title, reps, feedback }.
  // `planned` is the day it was posted for (older entries: the date at the start of the id).
  function finished(person) {
    const byId = new Map();
    (person.history || []).forEach((h) => { if (h.date) byId.set(h.id, { ...h }); });
    person.queue.forEach((w) => {
      if (!w.completed) return;
      const h = byId.get(w.id) || { id: w.id, date: w.completed, title: w.title };
      if (h.reps == null) h.reps = countReps(w);
      if (!h.planned) h.planned = w.date;
      if (!h.feedback && w.feedback) h.feedback = w.feedback;
      byId.set(w.id, h);
    });
    byId.forEach((h) => { if (!h.planned) h.planned = (/^\d{4}-\d{2}-\d{2}/.exec(String(h.id)) || [h.date])[0]; });
    return [...byId.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // Running totals: all time and per year.
  function totals(person) {
    const all = { workouts: 0, reps: 0, since: null }, years = new Map();
    finished(person).forEach((h) => {
      const y = h.date.slice(0, 4);
      if (!years.has(y)) years.set(y, { workouts: 0, reps: 0 });
      [all, years.get(y)].forEach((t) => { t.workouts++; t.reps += h.reps || 0; });
      if (!all.since) all.since = h.date;
    });
    return { ...all, years };
  }

  // Day streaks. A day with a finished workout adds 1. A day with nothing waiting
  // (a rest day: the agent posted nothing, and nothing earlier was left unfinished)
  // is skipped over without breaking the streak. A day where a workout was waiting
  // and none got finished ends it. Today never ends it, since there's still time.
  function streak(person, todayKey) {
    const shift = (key, n) => { const d = new Date(key + "T12:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const done = finished(person);
    if (!done.length) return { current: 0, best: 0 };
    const doneDays = new Set(done.map((h) => h.date));
    // Every workout's [posted, finished) window; unfinished ones are still open.
    const spans = done.map((h) => [h.planned || h.date, h.date])
      .concat(pending(person).map((w) => [w.date || todayKey, null]));
    const waiting = (day) => spans.some(([from, to]) => from <= day && (to === null || to > day));
    let run = 0, best = 0;
    for (let day = done[0].date; day <= todayKey; day = shift(day, 1)) {
      if (doneDays.has(day)) run++;
      else if (day !== todayKey && waiting(day)) run = 0;
      best = Math.max(best, run);
    }
    return { current: run, best };
  }

  // date ("YYYY-MM-DD") -> titles of workouts finished that day.
  function doneDays(person) {
    const seen = new Set(), days = new Map();
    const add = (id, date, title) => {
      if (!date || seen.has(id)) return;
      seen.add(id);
      if (!days.has(date)) days.set(date, []);
      days.get(date).push(title || "Workout");
    };
    (person.history || []).forEach((h) => add(h.id, h.date, h.title));
    person.queue.forEach((w) => add(w.id, w.completed, w.title));
    return days;
  }

  return { PEOPLE, MAX_PENDING, today, esc, doneDays, countReps, finished, totals, streak, RATINGS, setFeedback, getKey, setKey, loadPublic, pending, current, fromText, addWorkout, setCompleted };
})();
