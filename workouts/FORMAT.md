# Daily workout: instructions for the AI agent

Each morning, write today's workout to **`workouts/today.json`** in the GitHub
repository **BRICK-DELAY/brandondelay-site** (branch `main`), replacing what's
there. It appears at **https://www.brandondelay.com/workouts** about a minute
after it's saved. Older workouts stay in the repository's history.

## Easiest: the posting page

Open **https://www.brandondelay.com/workouts/post**, set the date and title,
paste the workout as plain text, and press **Save workout**. Use `## Heading`
lines for sections and one `- ` line per exercise (e.g. `- Back squat: 5 x 5 @ 225 lb, rest 3 min`).
The first time on a device it asks for a GitHub key (Contents: read and write on
this repository) and remembers it after that.

## The file

The posting page writes this file for you. Agents that use git or the GitHub API
can write it directly.

```json
{
  "date": "2026-10-19",
  "title": "Upper body strength",
  "focus": "Push / pull",
  "duration_min": 55,
  "location": "Gym",
  "intensity": "Moderate",
  "notes": "Optional note shown under the title.",
  "sections": [
    {
      "name": "Warm-up",
      "items": [
        { "exercise": "Rowing machine", "duration": "5 min", "detail": "easy pace" }
      ]
    },
    {
      "name": "Main",
      "rounds": 3,
      "notes": "Optional note for the section.",
      "items": [
        { "exercise": "Bench press", "sets": 4, "reps": "6–8", "weight": "185 lb", "rest": "2 min", "notes": "Last set to near failure" },
        { "exercise": "Run", "distance": "3 mi", "detail": "Zone 2" }
      ]
    }
  ],
  "cooldown": "Optional closing note.",
  "generated_by": "Claude"
}
```

- **`date`** (required): today's date as `YYYY-MM-DD`, in Brandon's time zone (America/Denver). If it isn't today's date, the page says today's workout hasn't been posted yet.
- **`title`** (required): a short name for the day.
- **`sections`**: list of blocks, each with a `name` and `items`. Each item needs `exercise`. Everything else is optional: `sets`, `reps`, `weight`, `duration`, `distance`, `tempo`, `rest`, `detail`, `notes`. Optional section fields are `rounds` and `notes`.
- **Optional top-level fields**: `focus`, `duration_min`, `location`, `intensity`, `notes`, `cooldown`, `generated_by`.
- **`markdown`**: instead of (or as well as) `sections`, you can send free text using `#` headings, `-` bullets and `**bold**`. The structured `sections` look better and let Brandon tick off each exercise.

## How to save it

**With git:** commit `workouts/today.json` to `main` and push. The commit message can be `Workout for YYYY-MM-DD`.

**With the GitHub API**, using a fine-grained token that has Contents: read and write on this repository:

1. `GET https://api.github.com/repos/BRICK-DELAY/brandondelay-site/contents/workouts/today.json` and read its `sha`.
2. `PUT` the same URL with JSON body `{"message": "Workout for YYYY-MM-DD", "content": "<base64 of the file>", "sha": "<sha from step 1>", "branch": "main"}`.

Only change `workouts/today.json`. Nothing else in the repository should be touched.
