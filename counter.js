// Visit counter, shown at the bottom of every page, powered by GoatCounter
// (https://www.goatcounter.com), free privacy-friendly analytics.
//
// GoatCounter records each page load; the site's routes live after the "#", so
// clicking around within a visit doesn't add page views. The footer shows the
// total number of visitors (GoatCounter counts a person once per session, not
// per page). Full stats: https://brandondelay.goatcounter.com
// Needs "Allow adding visitor counts on your website" turned on in GoatCounter's
// settings for the footer number to appear; if it isn't, the counter stays hidden.

window.VisitCounter = (function () {
  "use strict";
  const CODE = "brandondelay"; // the GoatCounter site code: https://CODE.goatcounter.com
  const ENDPOINT = `https://${CODE}.goatcounter.com`;

  // Record this page load.
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = `${ENDPOINT}/count`;
  document.head.appendChild(s);

  // Total visitors across the whole site. GoatCounter keeps each counter number
  // for 4+ hours before recalculating, but stores it separately per "start" date.
  // So ask with a start date that changes every 10 minutes, always years before
  // the site existed: the count is the same all-time total, at most 10 minutes old.
  const bucket = Math.floor(Date.now() / 600000) % 1800;
  const start = new Date(Date.UTC(2015, 0, 1 + bucket)).toISOString().slice(0, 10);
  const total = fetch(`${ENDPOINT}/counter/TOTAL.json?start=${start}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const n = j && Number(String(j.count).replace(/[^\d]/g, ""));
      return Number.isFinite(n) && j.count !== undefined ? n : null;
    })
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
