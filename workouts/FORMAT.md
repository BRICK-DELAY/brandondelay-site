# Daily workouts: instructions for the AI agent

Brandon, Cecelia, Jose and Isabelle each have a short queue of workouts at
**https://www.brandondelay.com/workouts** (`#brandon` / `#cecelia` / `#jose` / `#isabelle`). Each of them
sees their **oldest unfinished** workout until they press **Mark workout complete**,
so a missed day is never skipped: that workout simply waits.

A person can have at most **2 unfinished** workouts queued. Extra posts are refused
(nothing is saved) with a message saying so. That's expected; just try again the next day.

## Every morning

1. Open **https://www.brandondelay.com/workouts/post** and read the **status box** at the top.
   It lists each person's unfinished workouts and the last one they finished.
2. Under each name, the status box also lists **how their recent workouts felt**: a rating
   (**Too easy**, **Just right** or **Too hard**) and sometimes a note they typed (sore spots,
   swaps, requests). Use it when planning: progress when it's "Too easy", hold steady when
   "Just right", back off when "Too hard", and follow the notes (e.g. avoid an exercise that hurt).
3. For **each person** you plan for (Brandon, Cecelia, Jose, Isabelle):
   - **If they have 2 unfinished workouts:** post nothing for them today.
   - **If they finished yesterday's workout or have none waiting:** post the next workout in their plan.
   - **If they have 1 unfinished workout** (they missed a day): you may post the following workout as "up next". It appears only after they finish the current one. Don't repeat the missed workout; it's still there.
   - **Never plan rest days. Post a workout every day** for everyone. Each person picks their own
     rest days by holding a button on their page: up to **2 in any 7 days in a row**. A rest day
     goes into their `rest` list, and that day's workout simply waits until the next day (so their
     queue may already be full; then the post is refused, which is fine). The status box shows
     each person's rest days used in the last 7 days.
4. To post: pick the person, set the **date** (today, America/Denver) and a short **title**
   (e.g. "Legs: squat focus"), paste the workout as plain text, and press **Save workout**.
   Confirm the message says **Saved**.

Plain text format:

```
Optional note about the day (first lines before any heading).

## Warm-up
- Bike: 5 min easy
- Leg swings: 10 / side

## Strength
- Back squat: 5 x 5 @ 225 lb, rest 3 min
  Optional note for the exercise on the next line
- Romanian deadlift: 3 x 8

## Cooldown
- Couch stretch: 2 min / side
```

`## Heading` starts a section; each `- ` line is one exercise and becomes a checkbox
(`- Exercise: sets x reps @ weight, rest`).

The first time on a device, the form asks for a GitHub key and remembers it.

## Structured format (optional)

Instead of plain text you can paste JSON:

```json
{
  "title": "Upper body strength",
  "focus": "Push / pull",
  "duration_min": 55,
  "location": "Gym",
  "intensity": "Moderate",
  "notes": "Note under the title.",
  "sections": [
    { "name": "Main", "rounds": 3, "notes": "Section note.",
      "items": [
        { "exercise": "Bench press", "sets": 4, "reps": "6–8", "weight": "185 lb", "rest": "2 min", "notes": "Last set near failure", "url": "https://www.youtube.com/watch?v=example" },
        { "exercise": "Run", "distance": "3 mi", "detail": "Zone 2" },
        { "exercise": "Plank", "duration": "45 sec" }
      ] }
  ],
  "cooldown": "Closing note."
}
```

## Writing sets and reps (for the rep counter)

The page keeps a running total of workouts and reps for each person. Reps are counted
from each exercise when a workout is marked complete, so **start each exercise's
details with its sets and reps**:

- `3 x 8-10` counts 24 reps (the low end of a range).
- `2 x 10 / side` (or `/ leg`, `/ arm`, `each side`) counts both sides: 40.
- `10 reps` or `6 / side` (one set) counts 10 or 12.
- In JSON, `"sets": 3, "reps": "8-10"` works the same way, and a section's `rounds` multiplies its exercises.
- Timed or distance work (`45 sec`, `1 x 45-60 sec`, `3 mi`) adds no reps, which is expected.

`url` is optional on any item: a short demo video for that exercise. When present, the exercise name becomes a tappable link on the workout page. Links only work through the JSON format (or direct `plan.json` edits); the plain-text format has no link syntax.

## Without the form (git or GitHub API)

Everything lives in `workouts/plan.json` in the GitHub repository **BRICK-DELAY/brandondelay-site** (branch `main`):

```json
{ "people": {
    "brandon": { "name": "Brandon", "queue": [ { "id": "2026-10-19-legs-x1y2", "date": "2026-10-19", "title": "Legs", "sections": [], "completed": null } ] },
    "cecelia": { "name": "Cecelia", "queue": [] },
    "jose": { "name": "Jose", "queue": [] } } }
```

- To add a workout, append it to that person's `queue` with a unique `id`, today's `date`, and `"completed": null`.
- Don't add one if that person already has 2 entries with `"completed": null`.
- Each person may also have a `history` list of finished workouts (for the calendar, totals and streaks). Leave it alone.
- `"rest"` is a list of dates a person took off with the rest-day button (2 allowed in any 7 days;
  an optional `"rest_days"` number changes that for one person). The page writes it. The one time
  you add to it: someone without a key (Jose) tells you they're taking a rest day. Then add today's
  date, but only if they've taken fewer than 2 in the last 7 days (today and the 6 days before);
  otherwise tell them they've used both.
- A finished workout may have `"feedback": { "rating": "easy" | "right" | "hard", "note": "…" }`, written by the page. Read it when planning; don't change it.
- `completed` is set to a date by the page when they finish. Don't change it, and don't remove or reorder entries.
  The one exception is below: checking off a workout for someone who tells you they finished it.
- Read the file (and its `sha`) right before writing, and change nothing else in the repository.

## Checking off a workout for someone (e.g. Jose)

Someone without a key (Jose) tells their own agent when they finish, and it passes that on to you.
Only do this when the person (or their agent) says they finished. Then, in `plan.json`:

1. In that person's `queue`, find their **oldest** entry with `"completed": null` (the one their page shows).
   If they name a different workout, use that one.
2. Set `"completed"` to the day they finished, as `"YYYY-MM-DD"` (America/Denver). Usually today.
3. If they said how it felt, add `"feedback": { "rating": "easy" | "right" | "hard", "note": "…" }`
   ("Too easy" = `easy`, "Just right" = `right`, "Too hard" = `hard`; the note is optional, in their words).
4. Don't remove the entry. The page works out their reps, calendar, streak and leaderboard
   spot from the queue.
   - If they report what they actually did, you may record it: mark exercises they skipped with
     `"skipped": true` (and what they did instead in `"performed"`), and add or update their
     `history` entry (`id`, `date`, `planned`, `title`) with `"reps"` set to the confirmed count.
     A `reps` number in `history` overrides the planned count on the leaderboard, so only set it
     when you have real numbers (0 if they confirmed doing none).
5. Commit with a message like `Jose finished a workout`.
