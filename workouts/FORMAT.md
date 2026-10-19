# Daily workouts: instructions for the AI agent

Brandon and Cecelia each have a short queue of workouts at
**https://www.brandondelay.com/workouts** (`#brandon` / `#cecelia`). Each of them
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
3. For **each person** (Brandon, then Cecelia):
   - **If they have 2 unfinished workouts:** post nothing for them today.
   - **If they finished yesterday's workout or have none waiting:** post the next workout in their plan.
   - **If they have 1 unfinished workout** (they missed a day): you may post the following workout as "up next". It appears only after they finish the current one. Don't repeat the missed workout; it's still there.
   - **Rest day in their plan:** post nothing for them. A rest day doesn't break their streak
     as long as nothing is left waiting, so don't post a placeholder.
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
    "cecelia": { "name": "Cecelia", "queue": [] } } }
```

- To add a workout, append it to that person's `queue` with a unique `id`, today's `date`, and `"completed": null`.
- Don't add one if that person already has 2 entries with `"completed": null`.
- Each person may also have a `history` list of finished workouts (for the calendar, totals and streaks). Leave it alone.
- A finished workout may have `"feedback": { "rating": "easy" | "right" | "hard", "note": "…" }`, written by the page. Read it when planning; don't change it.
- `completed` is set to a date by the page when they finish. Don't change it, and don't remove or reorder entries.
- Read the file (and its `sha`) right before writing, and change nothing else in the repository.
