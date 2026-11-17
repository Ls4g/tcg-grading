// Apify account helpers: which actor to run and whether there is budget left.

// compsniper/compsniper-ebay-sold-listings: up to 240 sold listings per
// keyword, $0.002 per listing returned, with the real accepted Best Offer
// price where it can find it. Replaced caffein.dev/ebay-sold-listings on
// 17 Nov 2026 after a side-by-side test (Umbreon VMAX 215/203: 65 usable
// sales vs 39 for the same spend).
export const APIFY_SOLD_ACTOR = "compsniper~compsniper-ebay-sold-listings";
export const APIFY_USD_PER_LISTING = 0.002;

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
