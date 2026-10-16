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
- `data/photos.json`: the list of trips and photos. The admin page keeps it up to date.
- `data/site.json`: your name, headline, About text and links.
- `photos/<year>/` (full size, 2048px) and `thumbs/<year>/` (720px): the photos. They're shrunk in your browser before uploading, so the site stays fast.
- `admin/`: the uploader. It saves straight to this GitHub repository using your key.
- `vendor/`: two small open-source libraries. [exifr](https://github.com/MikeKovarik/exifr) reads photo dates and locations, and [heic2any](https://github.com/alexcorvi/heic2any) opens iPhone HEIC photos on computers that can't.

There's no build step: GitHub Pages serves these files exactly as they are.
