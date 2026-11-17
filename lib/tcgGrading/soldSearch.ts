// Fetching eBay sold listings for one or more cards through Apify.
//
// This spends real money ($0.002 per listing returned), so every run is
// capped by item count AND a dollar ceiling, refuses to start when the monthly
// budget is nearly gone, and every result is saved:
//
//   sales/<hash>.json    the latest fetch for a keyword (served for 12 hours)
//   history/<hash>.json  every listing ever seen for that keyword, by item id
//
// The history is the point. eBay only shows 90 days; this keeps growing.

import { APIFY_SOLD_ACTOR, APIFY_USD_PER_LISTING, hasSearchReserve, readApifyBudget, type ApifyBudget } from "../apifyBudget.ts";
import { keyFor, readJson, writeJson } from "../store.ts";
import type { SoldRow } from "./listings.ts";

export const GRADING_RESULTS = 80;
/** Ceiling per keyword: every listing at $0.002, plus 10% headroom. */
export const GRADING_MAX_CHARGE_USD = Math.round(GRADING_RESULTS * APIFY_USD_PER_LISTING * 1.1 * 100) / 100;
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
    keywords,
    mode: "recent",
    count: GRADING_RESULTS,
    ebaySite: "ebay.com",
    itemCondition: "any",
    // Our own rules decide what counts; the actor's AI cleaning could drop
    // exactly the variant titles we need to see and explain.
    relevance: false,
    bestOfferPrice: true,
  };
}

type ActorRow = SoldRow & {
  keyword?: string | null;
  bestOfferAccepted?: boolean | null;
  acceptedOfferPrice?: string | number | null;
  acceptedOfferPriceStatus?: string | null;
  thumbnailUrl?: string | null;
};

/**
 * CompSniper row -> our SoldRow. For a Best Offer sale the listed price is
 * the asking price, not what was paid: use the accepted offer when the actor
 * found it, otherwise keep the row marked so it is excluded with a reason.
 */
export function toSoldRow(row: ActorRow): SoldRow {
  const base: SoldRow = {
    itemId: row.itemId ?? null,
    title: row.title ?? null,
    url: row.url ?? null,
    endedAt: row.endedAt ?? null,
    soldPrice: row.soldPrice ?? null,
    soldCurrency: row.soldCurrency ?? null,
    imageUrl: row.thumbnailUrl ?? null,
  };
  if (!row.bestOfferAccepted) return base;
  const paid = row.acceptedOfferPrice;
  const paidNumber = paid === null || paid === undefined || paid === "" ? NaN : Number(paid);
  if (Number.isFinite(paidNumber) && paidNumber > 0) {
    return { ...base, soldPrice: paidNumber, askingPrice: row.soldPrice ?? null, bestOfferPaid: true };
  }
  return { ...base, isBestOfferAccepted: true };
}

export function gradingRunUrl(keywordCount = 1) {
  const url = new URL(`https://api.apify.com/v2/acts/${APIFY_SOLD_ACTOR}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", String(Math.min(180 + 30 * (keywordCount - 1), 290)));
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
  const rows = (await response.json()) as ActorRow[];
  if (!Array.isArray(rows)) throw new Error("The sold-listing search returned an unexpected response.");
  const byKeyword = new Map<string, SoldRow[]>(keywords.map((keyword) => [keyword, []]));
  for (const row of rows) {
    const keyword = row.keyword ?? (keywords.length === 1 ? keywords[0] : null);
    const list = keyword ? byKeyword.get(keyword) : undefined;
    if (list && list.length < GRADING_RESULTS) list.push(toSoldRow(row));
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
