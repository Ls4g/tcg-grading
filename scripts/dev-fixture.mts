// Dev only: builds a realistic /api/sales response without touching Apify.
// node --experimental-strip-types scripts/dev-fixture.mts > fixture.json
import { searchCards } from "../lib/tcgGrading/cards.ts";
import { priceResult } from "../lib/tcgGrading/price.ts";

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const row = (title: string, soldPrice: number, agoDays: number, itemId: string) =>
  ({ itemId, title, soldPrice, soldCurrency: "USD", url: `https://www.ebay.com/itm/${itemId}`, endedAt: day(agoDays) });
const rows = [
  row("Shanks OP01-120 Alternate Art Parallel One Piece PSA 10 cert 11111111", 320, 3, "1"),
  row("One Piece Shanks OP01-120 Alt Art PSA 10", 290, 12, "2"),
  row("Shanks (Parallel) OP01-120 Romance Dawn Foil PSA 10 #22222222", 340, 45, "3"),
  row("Shanks (Parallel) OP01-120 Romance Dawn Foil PSA 10 #22222222", 300, 80, "4"),
  row("One Piece CCG Shanks OP01-120 Alternate Art Secret Rare Foil PSA 9 2022", 125, 8, "5"),
  row("Shanks OP01-120 Alt Art PSA 9", 140, 50, "6"),
  row("Shanks OP01-120 Parallel PSA 8", 90, 20, "7"),
  row("Shanks OP01-120 Alternate Art Parallel One Piece CGC 10 Gem Mint", 180, 15, "8"),
  row("Shanks OP01-120 Alt Art CGC 9.5", 110, 25, "9"),
  row("2022 One Piece OP01 #120 Shanks Manga Alt Art PSA 10 Gem Mint English", 4500, 10, "10"),
  row("Shanks OP01-120 Alt Art PSA 10", 310, 120, "11"),
];
const [card] = (await searchCards("onepiece", "OP01-120")).filter((c) => c.id === "OP01-120");
const version = card.versions.find((v) => v.label === "Parallel")!;
const result = priceResult({ card, version }, "english", "Shanks OP01-120 (PSA,CGC,BGS,SGC,TAG)", {
  rows, history: rows, fetchedAt: new Date().toISOString(), cached: false, budget: { usedUsd: 2, maxUsd: 5, remainingUsd: 3 },
});
console.log(JSON.stringify(result));
