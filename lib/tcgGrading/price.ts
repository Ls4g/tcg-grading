// Server-side glue: card version + sold rows -> judged listings and buckets.
// Shared by the single-card and batch routes so both return the same shape.

import { resolveVersion, soldSearchKeyword, targetFor, type ResolvedVersion } from "./cards.ts";
import { bucketByGrade, dropPriceOutliers, dropRepeatSlabs, judgeListing, type GradeBucket, type ListingVerdict } from "./listings.ts";
import { GRADING_SEARCH_DAYS, type SoldSearchOutcome } from "./soldSearch.ts";

export type Language = "english" | "japanese";

export type PriceRequest = { game: "pokemon" | "onepiece"; versionKey: string; language: Language };

export type PriceResult = {
  card: ResolvedVersion["card"];
  version: ResolvedVersion["version"];
  language: Language;
  keyword: string;
  fetchedAt: string;
  cached: boolean;
  /** How many listings we hold for this keyword across every fetch. */
  historyCount: number;
  budgetRemainingUsd: number | null;
  buckets: GradeBucket[];
  listings: ListingVerdict[];
};

/** Reads and sanity-checks one request body item. Null when it's not usable. */
export function parsePriceRequest(input: unknown): PriceRequest | null {
  if (!input || typeof input !== "object") return null;
  const { game, versionKey, language } = input as Record<string, unknown>;
  if ((game !== "pokemon" && game !== "onepiece") || typeof versionKey !== "string" || !versionKey) return null;
  return {
    game,
    versionKey: versionKey.slice(0, 120),
    language: language === "japanese" && game === "onepiece" ? "japanese" : "english",
  };
}

export async function resolveRequest(request: PriceRequest) {
  const resolved = await resolveVersion(request.game, request.versionKey);
  return resolved ? { resolved, keyword: soldSearchKeyword(resolved, request.language) } : null;
}

export function priceResult(resolved: ResolvedVersion, language: Language, keyword: string, search: SoldSearchOutcome): PriceResult {
  const target = targetFor(resolved, language);
  // Judge the full history, not just the latest fetch, so nothing seen once is
  // lost. Prices older than the search window are shown but not counted.
  const since = new Date(Date.now() - GRADING_SEARCH_DAYS * 86_400_000).toISOString().slice(0, 10);
  const listings = dropPriceOutliers(dropRepeatSlabs(search.history.map((row) => {
    const verdict = judgeListing(target, row);
    if (verdict.used && verdict.soldDate && verdict.soldDate < since) {
      return { ...verdict, used: false, reason: `older than ${GRADING_SEARCH_DAYS} days (kept in history)` };
    }
    return verdict;
  })));
  return {
    card: resolved.card,
    version: resolved.version,
    language,
    keyword,
    fetchedAt: search.fetchedAt,
    cached: search.cached,
    historyCount: search.history.length,
    budgetRemainingUsd: search.budget?.remainingUsd ?? null,
    buckets: bucketByGrade(listings),
    listings,
  };
}
