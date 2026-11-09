// Fetching eBay sold listings for one card through Apify.
//
// This spends real money from the Apify account (about $0.004 per
// listing returned), so every run is capped by item count AND a dollar
// ceiling, refuses to start when the monthly budget is nearly gone, and is
// cached in memory so re-opening the same card doesn't pay again.

import { APIFY_SOLD_ACTOR, hasSearchReserve, readApifyBudget, type ApifyBudget } from "../apifyBudget.ts";
import type { SoldRow } from "./listings.ts";

export const GRADING_RESULTS = 40;
export const GRADING_MAX_CHARGE_USD = 0.2;
export const GRADING_SEARCH_DAYS = 90;
const CACHE_HOURS = 12;

type CacheEntry = { rows: SoldRow[]; fetchedAt: string };
const cache = new Map<string, CacheEntry>();

export type SoldSearchOutcome = {
  rows: SoldRow[];
  fetchedAt: string;
  cached: boolean;
  budget: ApifyBudget | null;
};

export function gradingRunUrl() {
  const url = new URL(`https://api.apify.com/v2/acts/${APIFY_SOLD_ACTOR}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", "150");
  url.searchParams.set("maxItems", String(GRADING_RESULTS));
  url.searchParams.set("maxTotalChargeUsd", GRADING_MAX_CHARGE_USD.toFixed(2));
  url.searchParams.set("restartOnError", "false");
  url.searchParams.set("limit", String(GRADING_RESULTS));
  return url.toString();
}

export async function searchGradedSales(token: string, keyword: string): Promise<SoldSearchOutcome> {
  const hit = cache.get(keyword);
  if (hit && Date.now() - Date.parse(hit.fetchedAt) < CACHE_HOURS * 3_600_000) {
    return { rows: hit.rows, fetchedAt: hit.fetchedAt, cached: true, budget: null };
  }

  const budget = await readApifyBudget(token);
  if (!hasSearchReserve(budget, GRADING_MAX_CHARGE_USD)) {
    throw new Error(
      `The Apify account has $${budget.remainingUsd.toFixed(2)} left of its $${budget.maxUsd.toFixed(2)} monthly limit, which is too little for another search. Raise the limit in Apify or wait for the monthly reset.`,
    );
  }

  const response = await fetch(gradingRunUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      categoryId: "0",
      count: GRADING_RESULTS,
      daysToScrape: GRADING_SEARCH_DAYS,
      ebaySite: "ebay.com",
      includeCompletedListings: false,
      itemCondition: "any",
      itemLocation: "default",
      keywords: [keyword],
      sortOrder: "endedRecently",
      subcategoryId: "",
      buyingFormat: "all",
    }),
  });
  if (!response.ok) throw new Error(`The eBay sold-listing search failed (HTTP ${response.status}).`);
  const rows = (await response.json()) as Array<SoldRow & { keyword?: string | null }>;
  if (!Array.isArray(rows)) throw new Error("The sold-listing search returned an unexpected response.");
  const ours = rows.filter((row) => (row.keyword ?? keyword) === keyword).slice(0, GRADING_RESULTS);

  const fetchedAt = new Date().toISOString();
  cache.set(keyword, { rows: ours, fetchedAt });
  return { rows: ours, fetchedAt, cached: false, budget };
}
