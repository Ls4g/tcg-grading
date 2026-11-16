// PSA's US service tiers. The tier you must use depends on the card's declared
// value (what it's worth after grading), so a card expected to sell for $800
// cannot go in at the $24.99 tier.
//
// Prices are PSA's published US list as of 2025, fee only, before shipping and
// insurance. They change; the UI shows the tier as a suggestion to edit.
export const PSA_FEES_AS_OF = "2025";

export type PsaTier = { name: string; feeUsd: number; maxDeclaredUsd: number };

export const PSA_TIERS: PsaTier[] = [
  { name: "Value", feeUsd: 24.99, maxDeclaredUsd: 499 },
  { name: "Regular", feeUsd: 74.99, maxDeclaredUsd: 1499 },
  { name: "Express", feeUsd: 149.99, maxDeclaredUsd: 2499 },
  { name: "Super Express", feeUsd: 299.99, maxDeclaredUsd: 4999 },
  { name: "Walk-Through", feeUsd: 599.99, maxDeclaredUsd: 9999 },
];

/** The cheapest PSA tier whose declared-value cap covers the expected sale price. */
export function suggestPsaTier(expectedSaleUsd: number): PsaTier | null {
  if (!Number.isFinite(expectedSaleUsd) || expectedSaleUsd <= 0) return null;
  return PSA_TIERS.find((tier) => expectedSaleUsd <= tier.maxDeclaredUsd) ?? null;
}
