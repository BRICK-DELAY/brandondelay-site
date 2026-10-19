// Visit counter, shown at the bottom of every page.
//
// Counts visits, not page views: the first page someone opens adds one, and
// clicking around doesn't. If they come back after 30+ minutes away, that's a
// new visit. The total is kept by Abacus (https://github.com/JasonLovesDoggo/abacus),
// a free counting service, so it works on this static site. If the service is
// unreachable, the counter just stays hidden.

window.VisitCounter = (function () {
  "use strict";
  const BASE = "https://abacus.jasoncameron.dev";
  const NAMESPACE = "brandondelay.com";
  const KEY = "visits";
  const NEW_VISIT_AFTER = 30 * 60 * 1000;
  const LAST_SEEN = "bd-last-seen";

  let last = 0;
  try { last = Number(localStorage.getItem(LAST_SEEN)) || 0; } catch (e) { /* private mode: counts each time */ }
  const isNewVisit = Date.now() - last > NEW_VISIT_AFTER;
  let touched = 0;
  const touch = () => {
    if (Date.now() - touched < 60000) return; // at most once a minute
    touched = Date.now();
    try { localStorage.setItem(LAST_SEEN, String(touched)); } catch (e) { /* ignore */ }
  };
  touch();
  // Keep the visit "open" while the person is still browsing.
  ["click", "scroll", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, touch, { passive: true }));
  addEventListener("hashchange", touch);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) touch(); });

  const total = fetch(`${BASE}/${isNewVisit ? "hit" : "get"}/${NAMESPACE}/${KEY}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && typeof j.value === "number" ? j.value : null))
    .catch(() => null);

  // Fills every [data-visits] element inside root with "1,234 visits".
  function fill(root) {
    total.then((n) => {
      if (n == null) return;
      (root || document).querySelectorAll("[data-visits]").forEach((el) => {
        el.textContent = `${n.toLocaleString()} visit${n === 1 ? "" : "s"}`;
        el.hidden = false;
      });
    });
  }
  return { total, fill };
})();
