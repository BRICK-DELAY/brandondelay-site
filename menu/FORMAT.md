# Weekly menu: instructions for the AI agent

Brandon's meal plan lives at **https://www.brandondelay.com/menu** (unlinked, not indexed).
It shows, for each week: the **grocery order** (items, quantities, prices, total), the **plan**
for each day, and the **recipes** with cooking steps. Everything comes from one file,
`menu/menu.json`, in the GitHub repository **BRICK-DELAY/brandondelay-site** (branch `main`).
Use the same GitHub key as the workouts page.

## Every week

The groceries are ordered through Instacart and arrive **Sunday evening**. For each order:

1. **Plan it (by Saturday):** add a new week to `weeks` with `"status": "planned"`: the days it
   covers (usually the 7 days starting the Sunday it arrives), the meals for each day, every
   recipe, and the shopping list with estimated prices.
2. **Fill the cart:** after putting the items in the Instacart cart, set `"status": "in_cart"`
   and update `price` on each item to what Instacart shows.
3. **Order it (Sunday):** after placing the order, set `"status": "ordered"` and fill in the real
   `subtotal`, `fees`, `tax`, `tip` and `total`.
4. **After delivery:** set `"status": "delivered"`. Mark anything that didn't come with
   `"unavailable": true`, or note a replacement with `"substitute": "what came instead"`. If that
   changes a recipe, update the recipe or its `notes`.

If the plan changes mid-week (eating out, a swap), edit that week's `days`.
Keep about the last **8 weeks** in the file and delete older ones (they stay in git history).

## The file

```json
{
  "updated": "2026-10-31",
  "weeks": [
    {
      "id": "2026-11-01",
      "title": "Fall comfort week",
      "notes": "Optional note shown under the title.",
      "order": {
        "date": "2026-11-01",
        "window": "5–7 pm",
        "status": "planned",
        "store": "Safeway",
        "url": "https://www.instacart.com/...",
        "notes": "Optional note about the order.",
        "items": [
          { "name": "Chicken thighs, boneless", "qty": "2 lb", "price": 9.98, "category": "Meat & seafood", "for": ["sheet-pan-chicken"] },
          { "name": "Broccoli crowns", "qty": "2", "price": 3.50, "category": "Produce", "for": ["sheet-pan-chicken", "stir-fry"] },
          { "name": "Greek yogurt, plain 32 oz", "qty": "1", "price": 5.49, "category": "Dairy & eggs", "note": "breakfasts" }
        ],
        "subtotal": null, "fees": null, "tax": null, "tip": null, "total": null
      },
      "days": [
        { "date": "2026-11-01", "meals": [ { "meal": "Dinner", "recipe": "sheet-pan-chicken" } ],
          "prep": "Cook a double batch of rice for Tuesday." },
        { "date": "2026-11-02", "meals": [
            { "meal": "Lunch", "recipe": "sheet-pan-chicken", "leftovers": true },
            { "meal": "Dinner", "text": "Eat out" } ] }
      ],
      "recipes": [
        {
          "id": "sheet-pan-chicken",
          "name": "Sheet-pan chicken and broccoli",
          "servings": 4, "time_min": 40, "active_min": 15,
          "ingredients": [
            { "qty": "2 lb", "item": "boneless chicken thighs" },
            { "qty": "2", "item": "broccoli crowns", "note": "cut into florets" },
            "2 tbsp olive oil"
          ],
          "steps": [
            "Heat the oven to 425°F.",
            "Toss the chicken and broccoli with oil, salt and pepper on a sheet pan.",
            "Roast 25–30 minutes, until the chicken reaches 165°F."
          ],
          "notes": "Makes enough for Monday's lunch.",
          "url": "https://example.com/original-recipe"
        }
      ],
      "pantry": ["olive oil", "salt", "rice"]
    }
  ]
}
```

- **Week `id`:** the date the order arrives (`YYYY-MM-DD`), unique per week. `title`/`notes` are optional.
- **`order.status`:** one of `planned`, `in_cart`, `ordered`, `delivered`. `date` = delivery day; `window` and `url` optional.
- **Items:** `name` (required), `qty`, `price` (a number: the line total in dollars for that quantity), `category` (an aisle, used for grouping: Produce, Meat & seafood, Dairy & eggs, Bakery, Pantry, Frozen, Snacks, Drinks, Household, Other), `for` (list of recipe ids it's used in), optional `note`, `unavailable`, `substitute`.
- **Totals:** leave `subtotal`/`fees`/`tax`/`tip`/`total` as `null` until known; the page adds up item prices as an estimate meanwhile.
- **Days:** `date`, `meals` (each with `meal`: Breakfast / Lunch / Dinner / Snack, and either `recipe` (a recipe `id`) or `text` for anything without a recipe), optional `leftovers: true`, `note`, and a day-level `prep` reminder.
- **Recipes:** `id` (lowercase-with-dashes, unique in the week), `name`, `servings`, `time_min` (total), optional `active_min`, `ingredients` (strings, or `{ qty, item, note }`), `steps` (strings, in order; one action each), optional `notes` and `url`.
- **`pantry`:** staples assumed to be at home, so they're not in the order.
- Set the top-level `updated` to today's date whenever you save.

## Rules

- Change only `menu/menu.json`. Read it (and its `sha`) right before writing, and write it back as valid JSON.
- Commit messages like `Menu: plan week of Nov 1`, `Menu: Nov 1 order placed ($142.18)`.
- Don't put addresses, phone numbers, payment or account details in the file: the page is public to anyone with the link.
