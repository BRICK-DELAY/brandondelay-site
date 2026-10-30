# BrandonDeLay.com

Brandon DeLay's travel photography website. It's hosted for free on GitHub Pages.

## Adding photos (the only thing you normally do)

1. Go to **brandondelay.com/admin** on your phone or computer.
2. Tap **Choose photos** and pick as many as you like.
3. The page sorts them into trips automatically:
   - Photos taken within a few days of each other become one trip.
   - Photos from the same dates as a trip already on the site get added to that trip.
   - New trips get a suggested name from the photo's location (e.g. "Kenya" or "Alaska").
4. Fix any names, then tap **Publish**. The website updates in about a minute.

The site menu shows each year (2026, 2025, 2024…) with a dropdown of that year's trips. Trips are filed under the year they started.

Other things you can do on the admin page:
- **Trips** tab: rename a trip, pick its cover photo, choose the big homepage photo, move a photo to a different trip, or delete photos.
- **Settings** tab: change the homepage text, the About page, your email/Instagram, and extra menu links like a Resume.

The first time you use the admin page on a device, it asks for a GitHub "key". The page shows the steps to make one.

## How it works (for the curious)

- `index.html`, `styles.css`, `app.js`: the public website.
- `map.js` + `data/flights.json`: the travel map under each year. `flights.json` lists places (name, lat, lon) and, per year, a `home` (one place id, or a list after a move) and `legs` (`from`, `to`, optional `"mode": "drive"`, optional `times` for repeat trips). A year with legs but no photos still gets a section. `"hidden": true` on a year keeps its data but shows no map. Map libraries and outlines live in `vendor/map/`.
- `data/photos.json`: the list of trips and photos. The admin page keeps it up to date.
- `data/site.json`: your name, headline, About text and links.
- `photos/<year>/` (full size, 2048px) and `thumbs/<year>/` (720px): the photos. They're shrunk in your browser before uploading, so the site stays fast.
- `workouts/`: unlinked, not-indexed pages. /workouts shows each person's (Brandon, Cecelia, Jose, Isabelle; listed in `PEOPLE` in `workouts/shared.js`) oldest unfinished workout from `workouts/plan.json` (a short queue per person; finishing one moves to the next, so missed days carry over). An AI agent adds workouts with the form at /workouts/post (max 2 unfinished per person). When one is finished the page saves it (with its rep count) to a `history` list per person, which feeds a 30-day calendar, all-time and per-year totals of workouts and reps, and a leaderboard of everyone (week / month / year / all time, plus each person's day streak; rest days with nothing waiting don't break it). Finishing a workout can include a rating and note (`feedback`) that the agent reads from the status box at /workouts/post. Shared code is in `workouts/shared.js`; agent instructions are in `workouts/FORMAT.md`.
- `counter.js`: visit counting with [GoatCounter](https://www.goatcounter.com) (site code `brandondelay`, stats at brandondelay.goatcounter.com). The footer shows the site's total visitors via GoatCounter's visitor-counter JSON; it stays hidden until that's enabled in GoatCounter's settings.
- `admin/`: the uploader. It saves straight to this GitHub repository using your key.
- `vendor/`: small open-source libraries. [exifr](https://github.com/MikeKovarik/exifr) reads photo dates and locations, and [heic2any](https://github.com/alexcorvi/heic2any) opens iPhone HEIC photos on computers that can't.

There's no build step: GitHub Pages serves these files exactly as they are.

When changing `styles.css`, `app.js` or `map.js`, bump the number in `version.json` so visitors' browsers load the new files right away. (The uploader has its own `admin/version.json`, paired with `VERSION` in `admin/admin.js`.)
