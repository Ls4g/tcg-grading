// Apify account helpers: which actor to run and whether there is budget left.

// caffein.dev/ebay-sold-listings. Its `sold` flag only echoes the search
// filter, so a returned row is a sold-listing search hit, not proof of sale.
export const APIFY_SOLD_ACTOR = "oTtB3VgfuE9GtxQt2";

// Refuse to start a run when less than this is left on the account. A run that
// begins and cannot finish still charges for what it fetched.
export const MIN_REMAINING_USD = 0.5;

export type ApifyBudget = { usedUsd: number; maxUsd: number; remainingUsd: number };

export function hasSearchReserve(budget: ApifyBudget, maxChargeUsd: number): boolean {
  return budget.remainingUsd >= MIN_REMAINING_USD + maxChargeUsd;
}

export async function readApifyBudget(token: string): Promise<ApifyBudget> {
  const response = await fetch("https://api.apify.com/v2/users/me/limits", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Apify would not report the account balance (HTTP ${response.status}).`);
  const data = ((await response.json()) as { data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } } }).data ?? {};
  const usedUsd = data.current?.monthlyUsageUsd ?? 0;
  const maxUsd = data.limits?.maxMonthlyUsageUsd ?? 0;
  return { usedUsd, maxUsd, remainingUsd: Math.max(0, maxUsd - usedUsd) };
}
