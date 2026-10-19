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
2. For **each person** (Brandon, then Cecelia):
   - **If they have 2 unfinished workouts:** post nothing for them today.
   - **If they finished yesterday's workout or have none waiting:** post the next workout in their plan.
   - **If they have 1 unfinished workout** (they missed a day): you may post the following workout as "up next". It appears only after they finish the current one. Don't repeat the missed workout; it's still there.
3. To post: pick the person, set the **date** (today, America/Denver) and a short **title**
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
- Each person may also have a `history` list of finished days (for the 30-day calendar). Leave it alone.
- `completed` is set to a date by the page when they finish. Don't change it, and don't remove or reorder entries.
- Read the file (and its `sha`) right before writing, and change nothing else in the repository.
