# TCG Grading Check

Look up a Pokémon or One Piece card, pick the exact version (1st Edition, Shadowless, Parallel, Manga, reprints…) and language, and see what it actually sold for graded on eBay.com over the last 90 days: median price per company and grade, profit after raw cost, fees and grading cost, and the lowest grade that still pays.

Every listing used, and every listing excluded (with its reason and link), is shown so the numbers can be checked.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `APP_USERNAME` / `APP_PASSWORD`: the single shared login (browser sign-in prompt). With these unset, the app refuses every request.
   - `APIFY_TOKEN`: used for eBay sold-listing searches.
   - `POKEMONTCG_API_KEY` (optional): higher pokemontcg.io rate limits.
3. `npm run dev`

## Cost

Each new card lookup is one capped Apify run (40 results, $0.20 ceiling, about $0.16 typical). Repeat lookups of the same card within 12 hours are served from an in-memory cache. Runs are refused when the Apify account has less than $0.70 left of its monthly limit.

## Checks

`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Data sources

- Cards and raw prices: api.pokemontcg.io, optcgapi.com (TCGplayer market prices)
- Graded sold listings: eBay.com via the Apify actor `caffein.dev/ebay-sold-listings`
