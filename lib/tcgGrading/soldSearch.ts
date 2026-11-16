// Fetching eBay sold listings for one or more cards through Apify.
//
// This spends real money (about $0.004 per listing returned), so every run is
// capped by item count AND a dollar ceiling, refuses to start when the monthly
// budget is nearly gone, and every result is saved:
//
//   sales/<hash>.json    the latest fetch for a keyword (served for 12 hours)
//   history/<hash>.json  every listing ever seen for that keyword, by item id
//
// The history is the point. eBay only shows 90 days; this keeps growing.

import { APIFY_SOLD_ACTOR, hasSearchReserve, readApifyBudget, type ApifyBudget } from "../apifyBudget.ts";
import { keyFor, readJson, writeJson } from "../store.ts";
import type { SoldRow } from "./listings.ts";

export const GRADING_RESULTS = 40;
export const GRADING_MAX_CHARGE_USD = 0.2;
export const GRADING_SEARCH_DAYS = 90;
export const CACHE_HOURS = 12;
/** Cards per paid batch run. Keeps one run's ceiling at $2. */
export const BATCH_MAX_KEYWORDS = 10;

type Snapshot = { rows: SoldRow[]; fetchedAt: string };
type History = { rows: SoldRow[]; firstSeenAt: string; lastFetchAt: string; fetches: number };

export type SoldSearchOutcome = {
  rows: SoldRow[];
  /** Every row ever seen for this keyword, most recent fetch merged in. */
  history: SoldRow[];
  fetchedAt: string;
  cached: boolean;
  budget: ApifyBudget | null;
};

function isFresh(snapshot: Snapshot | null): snapshot is Snapshot {
  return Boolean(snapshot && Date.now() - Date.parse(snapshot.fetchedAt) < CACHE_HOURS * 3_600_000);
}

function rowId(row: SoldRow) {
  return row.itemId || row.url || `${row.title}|${row.endedAt}|${row.soldPrice}`;
}

async function mergeHistory(keyword: string, rows: SoldRow[], fetchedAt: string): Promise<SoldRow[]> {
  const key = await keyFor("history", keyword);
  const existing = (await readJson<History>(key)) ?? { rows: [], firstSeenAt: fetchedAt, lastFetchAt: fetchedAt, fetches: 0 };
  const byId = new Map(existing.rows.map((row) => [rowId(row), row]));
  for (const row of rows) byId.set(rowId(row), row);
  const merged = [...byId.values()].sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
  await writeJson(key, { rows: merged, firstSeenAt: existing.firstSeenAt, lastFetchAt: fetchedAt, fetches: existing.fetches + 1 });
  return merged;
}

async function readHistory(keyword: string): Promise<SoldRow[]> {
  return (await readJson<History>(await keyFor("history", keyword)))?.rows ?? [];
}

function runBody(keywords: string[]) {
  return {
    categoryId: "0",
    count: GRADING_RESULTS,
    daysToScrape: GRADING_SEARCH_DAYS,
    ebaySite: "ebay.com",
    includeCompletedListings: false,
    itemCondition: "any",
    itemLocation: "default",
    keywords,
    sortOrder: "endedRecently",
    subcategoryId: "",
    buyingFormat: "all",
  };
}

export function gradingRunUrl(keywordCount = 1) {
  const url = new URL(`https://api.apify.com/v2/acts/${APIFY_SOLD_ACTOR}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", String(Math.min(150 + 60 * (keywordCount - 1), 300)));
  url.searchParams.set("maxItems", String(GRADING_RESULTS * keywordCount));
  url.searchParams.set("maxTotalChargeUsd", (GRADING_MAX_CHARGE_USD * keywordCount).toFixed(2));
  url.searchParams.set("restartOnError", "false");
  url.searchParams.set("limit", String(GRADING_RESULTS * keywordCount));
  return url.toString();
}

async function runSearch(token: string, keywords: string[]): Promise<Map<string, SoldRow[]>> {
  const response = await fetch(gradingRunUrl(keywords.length), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(runBody(keywords)),
  });
  if (!response.ok) throw new Error(`The eBay sold-listing search failed (HTTP ${response.status}).`);
  const rows = (await response.json()) as Array<SoldRow & { keyword?: string | null }>;
  if (!Array.isArray(rows)) throw new Error("The sold-listing search returned an unexpected response.");
  const byKeyword = new Map<string, SoldRow[]>(keywords.map((keyword) => [keyword, []]));
  for (const row of rows) {
    const keyword = row.keyword ?? (keywords.length === 1 ? keywords[0] : null);
    const list = keyword ? byKeyword.get(keyword) : undefined;
    if (list && list.length < GRADING_RESULTS) list.push(row);
  }
  return byKeyword;
}

async function requireReserve(token: string, keywordCount: number) {
  const budget = await readApifyBudget(token);
  const needed = GRADING_MAX_CHARGE_USD * keywordCount;
  if (!hasSearchReserve(budget, needed)) {
    throw new Error(
      `The Apify account has $${budget.remainingUsd.toFixed(2)} left of its $${budget.maxUsd.toFixed(2)} monthly limit, which is too little for ${keywordCount === 1 ? "another search" : `${keywordCount} searches`}. Raise the limit in Apify or wait for the monthly reset.`,
    );
  }
  return budget;
}

export async function searchGradedSales(token: string, keyword: string): Promise<SoldSearchOutcome> {
  const [result] = await searchGradedSalesBatch(token, [keyword]);
  return result;
}

/**
 * Prices several cards in ONE paid Apify run (cached keywords are skipped and
 * cost nothing). Results come back in the same order as the keywords.
 */
export async function searchGradedSalesBatch(token: string, keywords: string[]): Promise<SoldSearchOutcome[]> {
  const unique = [...new Set(keywords)];
  if (!unique.length) return [];
  if (unique.length > BATCH_MAX_KEYWORDS) throw new Error(`At most ${BATCH_MAX_KEYWORDS} cards can be priced in one batch.`);

  const outcomes = new Map<string, SoldSearchOutcome>();
  const toFetch: string[] = [];
  for (const keyword of unique) {
    const snapshot = await readJson<Snapshot>(await keyFor("sales", keyword));
    if (isFresh(snapshot)) {
      outcomes.set(keyword, { rows: snapshot.rows, history: await readHistory(keyword), fetchedAt: snapshot.fetchedAt, cached: true, budget: null });
    } else {
      toFetch.push(keyword);
    }
  }

  if (toFetch.length) {
    const budget = await requireReserve(token, toFetch.length);
    const fetched = await runSearch(token, toFetch);
    const fetchedAt = new Date().toISOString();
    for (const keyword of toFetch) {
      const rows = fetched.get(keyword) ?? [];
      await writeJson(await keyFor("sales", keyword), { rows, fetchedAt } satisfies Snapshot);
      const history = await mergeHistory(keyword, rows, fetchedAt);
      outcomes.set(keyword, { rows, history, fetchedAt, cached: false, budget });
    }
  }

  return keywords.map((keyword) => outcomes.get(keyword) as SoldSearchOutcome);
}
