// Dev only: judge saved sold rows (JSON array) for one card version.
//   node --experimental-strip-types scripts/dev-judge-file.mts <rows.json> <game> "<search>" "<version label substring>" [japanese]
// Accepts CompSniper rows: an accepted Best Offer uses acceptedOfferPrice.
import { readFileSync } from "node:fs";
import { searchCards, targetFor } from "../lib/tcgGrading/cards.ts";
import { bucketByGrade, dropRepeatSlabs, judgeListing, type SoldRow } from "../lib/tcgGrading/listings.ts";

type CsRow = SoldRow & { bestOfferAccepted?: boolean | null; acceptedOfferPrice?: string | number | null; totalPrice?: string | null };

const [file, game, query, versionHint, lang] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, "utf8")) as CsRow[];
const [card] = await searchCards(game as "pokemon" | "onepiece", query);
const version = card.versions.find((v) => v.label.toLowerCase().includes(versionHint.toLowerCase())) ?? card.versions[0];
const target = targetFor({ card, version }, lang === "japanese" ? "japanese" : "english");

let bestOffer = 0, bestOfferPriced = 0;
const rows: SoldRow[] = raw.map((row) => {
  if (!row.bestOfferAccepted) return row;
  bestOffer += 1;
  const paid = row.acceptedOfferPrice;
  if (paid != null && paid !== "" && !Number.isNaN(Number(paid))) {
    bestOfferPriced += 1;
    return { ...row, soldPrice: paid, isBestOfferAccepted: false };
  }
  return { ...row, isBestOfferAccepted: true };
});
const listings = dropRepeatSlabs(rows.map((row) => judgeListing(target, row)));
const used = listings.filter((l) => l.used);
const dates = used.map((l) => l.soldDate).filter(Boolean).sort();
console.log(`${card.name} ${card.number} · ${version.label} · rows ${raw.length} · used ${used.length} · best offer ${bestOffer} (real price for ${bestOfferPriced}) · span ${dates[0]} → ${dates.at(-1)}`);
for (const b of bucketByGrade(listings)) console.log(`  ${b.label.padEnd(20)} n=${String(b.count).padStart(2)} median $${b.median} range $${b.low}-$${b.high}`);
const reasons = new Map<string, number>();
for (const l of listings.filter((x) => !x.used)) reasons.set(l.reason.replace(/\(.*\)/, "(…)"), (reasons.get(l.reason.replace(/\(.*\)/, "(…)")) ?? 0) + 1);
console.log("  excluded:", Object.fromEntries(reasons));
if (process.env.SHOW_USED) for (const l of used) console.log(`    $${l.price} ${l.grade?.label} ${l.soldDate} | ${l.title}`);
