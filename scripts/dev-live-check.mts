// Dev only: one real lookup end to end, printed as text.
//   APIFY_TOKEN=... node --experimental-strip-types scripts/dev-live-check.mts <game> "<search>" "<version label substring>" [japanese]
// Spends Apify credit (one capped run, ~$0.16).
import { searchCards } from "../lib/tcgGrading/cards.ts";
import { adviseOn } from "../lib/tcgGrading/advice.ts";
import { parsePriceRequest, priceResult, resolveRequest } from "../lib/tcgGrading/price.ts";
import { searchGradedSales } from "../lib/tcgGrading/soldSearch.ts";

const [game, query, versionHint, lang] = process.argv.slice(2);
const cards = await searchCards(game as "pokemon" | "onepiece", query);
console.log(`cards found: ${cards.length}`);
for (const c of cards.slice(0, 6)) console.log(`  ${c.id} ${c.name} ${c.number} · ${c.setName} · versions: ${c.versions.map((v) => v.label).join(" | ")}`);
const card = cards.find((c) => c.versions.some((v) => v.label.toLowerCase().includes(versionHint.toLowerCase()))) ?? cards[0];
const version = card.versions.find((v) => v.label.toLowerCase().includes(versionHint.toLowerCase())) ?? card.versions[0];
console.log(`\nPICKED: ${card.name} ${card.number} · ${card.setName} · ${version.label} · raw $${version.rawMarketUsd}`);

const request = parsePriceRequest({ game, versionKey: version.key, language: lang === "japanese" ? "japanese" : "english" })!;
const found = (await resolveRequest(request))!;
console.log(`eBay search: ${found.keyword}`);
const search = await searchGradedSales(process.env.APIFY_TOKEN ?? "x", found.keyword);
const result = priceResult(found.resolved, request.language, found.keyword, search);
console.log(`rows returned: ${search.rows.length} · budget left: $${search.budget?.remainingUsd?.toFixed(2)}`);

const advice = adviseOn(result.buckets, { rawCost: version.rawMarketUsd ?? 0, sellFeePct: 13, gradingCost: { PSA: 24.99, CGC: 20, BGS: 25 }, gradeOdds: { 10: 30, 9: 45, 8: 20, 7: 5 } });
console.log(`\nVERDICT: ${advice.verdict}`);
console.log("\nBUCKETS:");
for (const o of advice.outcomes) console.log(`  ${o.label.padEnd(20)} n=${o.count} median $${o.median} range $${o.low}-$${o.high} 30d ${o.recentMedian ?? "-"} (${o.recentCount}) net ${o.net ?? o.uplift}`);
for (const e of advice.expected) console.log(`  EXPECTED ${e.company}: ${e.expectedNet} (covers ${e.coveredPct}%)`);
for (const line of [...advice.sameGrade, ...advice.crossGrade, ...advice.breakEven, ...advice.warnings]) console.log(`  - ${line}`);

console.log("\nUSED:");
for (const l of result.listings.filter((x) => x.used)) console.log(`  $${l.price} ${l.grade?.label} ${l.soldDate} | ${l.title}`);
console.log("\nEXCLUDED:");
const reasons = new Map<string, number>();
for (const l of result.listings.filter((x) => !x.used)) {
  const key = l.reason.replace(/\(.*\)/, "(…)");
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
  console.log(`  [${l.reason}] $${l.price} | ${l.title}`);
}
console.log("\nEXCLUSION SUMMARY:", Object.fromEntries(reasons));
