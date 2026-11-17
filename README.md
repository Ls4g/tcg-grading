# TCG Grading Check

Look up a Pokémon or One Piece card, pick the exact version (1st Edition, Shadowless, Parallel, Manga, reprints…) and language, and see what it actually sold for graded on eBay.com over the last 90 days: median price per company and grade, profit after raw cost, fees and grading cost, and the lowest grade that still pays.

Every listing used, and every listing excluded (with its reason and link), is shown so the numbers can be checked.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `APP_USERNAME` / `APP_PASSWORD`: the single shared login (browser sign-in prompt). With these unset, the app refuses every request.
   - `APIFY_TOKEN`: used for eBay sold-listing searches.
   - `POKEMONTCG_API_KEY` (optional): higher pokemontcg.io rate limits.
   - `BLOB_READ_WRITE_TOKEN` (optional locally; set automatically on Vercel): persistent cache and sales history.
3. `npm run dev`

## What it does

- **Grade odds → expected profit.** Enter your odds of a 10 / 9 / 8 / 7-or-lower (or pick a preset) and get one expected-profit number per grading company. Grades with no sales are reported as uncovered, not guessed.
- **Batch.** Add up to 10 card versions, price them in one Apify run, and get a ranked table of the best grading candidates.
- **Repeat slabs counted once.** Cert numbers are read from titles; the same slab sold twice is one data point.
- **30-day trend** next to the 90-day median, per grade.
- **PSA tier hint** from the expected sale price (PSA US list prices as of 2025; edit them in `lib/tcgGrading/gradingFees.ts`).
- **Every lookup is saved** (Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, otherwise memory): results are served from the store for 12 hours, and every listing ever seen is kept in `history/` so a price history builds up beyond eBay's 90-day window.

## Cost

Each new card lookup is one capped Apify run of the CompSniper eBay sold-listings actor: up to 80 sold listings at $0.002 each (so at most $0.16, with an $0.18 ceiling), including the real accepted Best Offer price where it can be found. Repeat lookups of the same card within 12 hours are served from the store. Runs are refused when the Apify account has less than $0.50 plus the run's ceiling left of its monthly limit.

## Checks

`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

To look at the results UI without spending Apify credit, `node --experimental-strip-types scripts/dev-fixture.mts > fixture.json` builds a realistic `/api/sales` response from real titles; serve it to the page with a browser route mock.

## Data sources

- Cards and raw prices: api.pokemontcg.io, optcgapi.com (TCGplayer market prices)
- Graded sold listings: eBay.com via the Apify actor `compsniper/compsniper-ebay-sold-listings` (switched from `caffein.dev/ebay-sold-listings` on 17 Nov 2026 after a side-by-side test)
