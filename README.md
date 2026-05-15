# Meralco Rotational Brownout Map

Daily-scraped, barangay-level view of Meralco's rotational brownout schedule.
Source: <https://company.meralco.com.ph/news-and-advisories/rotational-brownout>

## How it works

1. `scripts/scrape.mjs` fetches the Meralco advisory page (with a real Chrome `User-Agent` — the default `undici` UA is 403'd) and parses the embedded HTML schedule into `public/data/latest.json` plus a dated archive `public/data/YYYY-MM-DD.json`.
2. A GitHub Actions cron (`.github/workflows/scrape.yml`) runs the scraper daily at 00:00 UTC (08:00 PHT) and commits any changes back to the repo.
3. Vercel auto-deploys on push, so the site picks up the new JSON on every successful scrape.
4. The Next.js page (`src/app/page.tsx`) reads `public/data/latest.json` server-side and passes the schedule to a MapLibre client component (`src/components/BrownoutMap.tsx`).

Barangay polygon overlays / fuzzy name-to-PSGC matching are deferred — the current UI lists affected provinces → cities → barangays in a side panel.

## Local dev

```bash
npm install
npm run scrape        # seed public/data/latest.json
npm run dev           # http://localhost:3000
```

## Deploy

1. Push the repo to GitHub.
2. Import the repo on Vercel (no env vars required — OpenFreeMap tiles need no key).
3. Verify the workflow runs: GitHub repo → Actions → "Scrape Meralco rotational brownout schedule" → "Run workflow".

## JSON shape

```ts
interface Schedule {
  source_url: string;
  scraped_at: string;       // ISO 8601
  schedule_date: string;    // YYYY-MM-DD
  advisory: string | null;
  windows: Array<{
    start: string | null;   // HH:MM (24h)
    end:   string | null;
    label: string;          // e.g. "Between 2:01PM and 5:00PM"
    provinces: Array<{
      name: string;
      cities: Array<{
        name: string;
        barangays: string[];
      }>;
    }>;
  }>;
}
```
