// Grading-check rules, tested against real eBay sold-listing titles.
//
//   node --experimental-strip-types scripts/test-tcg-grading.mjs
//
// Titles below were returned by the live Apify eBay sold search on 9 Nov 2026
// for "Shanks OP01-120" and "Charizard 4/102". They are the point of the test:
// the same card number covers base, parallel, manga, Premium Booster reprint,
// Japanese, Chinese, signed and serialized copies, and Celebrations reprints,
// all at very different prices.
import assert from "node:assert/strict";
import { bucketByGrade, judgeListing, parseGrade } from "../lib/tcgGrading/listings.ts";
import { adviseOn } from "../lib/tcgGrading/advice.ts";

const row = (title, soldPrice, extra = {}) => ({ title, soldPrice, soldCurrency: "USD", url: "https://www.ebay.com/itm/1", endedAt: "2026-11-01T00:00:00Z", ...extra });

// ---- Grade parsing ----
const grades = {
  "One Piece Shanks OP01-120 Romance Dawn ENG PSA10! /143*": "PSA 10",
  "Shanks (120) Alternate Art OP01-120 Romance Dawn Foil PSA9": "PSA 9",
  "2024 ONE PIECE SHANKS SECRET RARE OP01-120 CGC 10 PRISTINE TL3": "CGC 10 Pristine",
  "Graded Shanks OP01-120 The Best SEC Alt Art 10 CGC One Piece": "CGC 10",
  "One Piece GRADED Shanks PRB01 OP01-120 SEC Alt Art The Best GM 10 CGC": "CGC 10",
  "Pokemon 1999 Charizard 4/102 Holo Base Set Shadowless BGS 7.5": "BGS 7.5",
  "Pokemon TCG Charizard 4/102 Base Set Unlimited Holo 1999 BGS 9 Mint": "BGS 9",
  "1999 Charizard 4/102 Holo PSA 4": "PSA 4",
  "Charizard 4/102 BGS 10 Black Label": "BGS 10 Black Label",
};
for (const [title, label] of Object.entries(grades)) assert.equal(parseGrade(title)?.label, label, title);
assert.equal(parseGrade("Charizard 4/102 PSA 9 crossover from CGC 9.5"), null, "two companies is ambiguous");
assert.equal(parseGrade("Charizard 4/102 Base Set Holo"), null);

// ---- One Piece versions ----
const op = [
  row("One Piece Shanks OP01-120 Romance Dawn ENG PSA10! /143*", 144.85),
  row("One Piece CCG Shanks OP01-120 Alternate Art Secret Rare Foil PSA 9 2022", 125),
  row("Shanks (Parallel) OP01-120 Romance Dawn Foil PSA 9", 50),
  row("2022 One Piece OP01 #120 Shanks Manga Alt Art PSA 10 Gem Mint English", 4500),
  row("SHANKS MANGA ALTERNATE ART ONE PIECE JAPANESE OP01-120 ROMANCE DAWN 2022 PSA 10", 1404.02),
  row("PSA 10 Shanks (Manga Alt Art) OP01-120 SEC ROMANCE DAWN ONE PIECE Chinese 2022", 365),
  row("One Piece Graded: Shanks OP01-120 Serialized Top Prize PSA 10", 3449.99),
  row("Brandon Potter Signed 2022 One Piece #OP01-120 Shanks Manga Art CGC 10 AUTO 10", 2700),
  row("Bandai Shanks OP01-120 Premium Booster The Best Alt Art Secret Rare Foil PSA 10", 205.5),
  row("Shanks OP01-120 Alternate Art Parallel One Piece CGC 10 Gem Mint", 80),
  row("PSA 8 Shanks OP01-120 Comic Parallel One Piece Card Game Japanese", 809.61),
  row("Shanks OP01-120 Alt Art PSA 10", 300, { isBestOfferAccepted: true }),
  row("Shanks OP01-120 Alt Art PSA 10", 300, { soldCurrency: "GBP" }),
  row("Shanks OP01-120 Alt Art PSA 10", 300, { url: null }),
];
const shanks = (variantTags, language = "english") => ({ game: "onepiece", name: "Shanks", number: "OP01-120", variantTags, language });
const usedTitles = (target, rows) => rows.map((r) => judgeListing(target, r)).filter((v) => v.used).map((v) => v.title);

assert.deepEqual(usedTitles(shanks([]), op), ["One Piece Shanks OP01-120 Romance Dawn ENG PSA10! /143*"]);
assert.deepEqual(usedTitles(shanks(["alt-art"]), op), [
  "One Piece CCG Shanks OP01-120 Alternate Art Secret Rare Foil PSA 9 2022",
  "Shanks (Parallel) OP01-120 Romance Dawn Foil PSA 9",
  "Shanks OP01-120 Alternate Art Parallel One Piece CGC 10 Gem Mint",
]);
assert.deepEqual(usedTitles(shanks(["manga"]), op), ["2022 One Piece OP01 #120 Shanks Manga Alt Art PSA 10 Gem Mint English"]);
assert.deepEqual(usedTitles(shanks(["manga"], "japanese"), op), [
  "SHANKS MANGA ALTERNATE ART ONE PIECE JAPANESE OP01-120 ROMANCE DAWN 2022 PSA 10",
  "PSA 8 Shanks OP01-120 Comic Parallel One Piece Card Game Japanese",
]);
assert.deepEqual(usedTitles(shanks(["prb", "alt-art"]), op), ["Bandai Shanks OP01-120 Premium Booster The Best Alt Art Secret Rare Foil PSA 10"]);

const reasons = op.map((r) => judgeListing(shanks(["alt-art"]), r).reason);
assert.match(reasons[6], /serialized/);
assert.match(reasons[7], /signed/);
assert.match(reasons[11], /best offer/);
assert.match(reasons[12], /GBP/);
assert.match(reasons[13], /link/);

// ---- Pokémon prints ----
const pk = [
  row("1999 Charizard 4/102 Holo PSA 4", 345),
  row("Pokémon TCG Charizard 1999 Base Set 4/102 Holo Rare PSA 5 Graded EN", 507.38),
  row("Pokemon Celebrations Charizard 4/102 Classic Collection Holo Card CGC 9 Mint", 135),
  row("Pokémon 30th Anniversary Celebration Charizard 4/102 NM PSA10 contender pregrade", 185),
  row("Pokemon 1999 Charizard 4/102 Holo Base Set Shadowless PSA 4", 1016.01),
  row("Pokemon TCG Charizard 4/102 Base Set Unlimited Holo 1999 BGS 9 Mint", 1200),
  row("Charizard 4/102 Base Set 1st Edition Holo PSA 7", 9000),
  row("1999 Pokemon Base Set 1st Edition Shadowless Charizard 4/102 PSA 6", 8000),
  row("Charizard 4/130 Base Set 2 Holo PSA 9", 400),
  row("Japanese Charizard No. 006 Base Set Holo PSA 8", 600),
];
const zard = (variantTags) => ({ game: "pokemon", name: "Charizard", number: "4", printedTotal: 102, variantTags, language: "english" });
assert.deepEqual(usedTitles(zard([]), pk), [
  "1999 Charizard 4/102 Holo PSA 4",
  "Pokémon TCG Charizard 1999 Base Set 4/102 Holo Rare PSA 5 Graded EN",
  "Pokemon TCG Charizard 4/102 Base Set Unlimited Holo 1999 BGS 9 Mint",
]);
assert.deepEqual(usedTitles(zard(["shadowless"]), pk), ["Pokemon 1999 Charizard 4/102 Holo Base Set Shadowless PSA 4"]);
assert.deepEqual(usedTitles(zard(["1st-edition"]), pk), [
  "Charizard 4/102 Base Set 1st Edition Holo PSA 7",
  "1999 Pokemon Base Set 1st Edition Shadowless Charizard 4/102 PSA 6",
]);
assert.deepEqual(usedTitles(zard(["reprint"]), pk), ["Pokemon Celebrations Charizard 4/102 Classic Collection Holo Card CGC 9 Mint"]);

// ---- Buckets + advice ----
const verdicts = [
  ...[100, 120, 110].map((p) => judgeListing(zard([]), row(`Charizard 4/102 PSA 10`, p))),
  ...[40, 45, 50].map((p) => judgeListing(zard([]), row(`Charizard 4/102 PSA 9`, p))),
  ...[120, 130, 125].map((p) => judgeListing(zard([]), row(`Charizard 4/102 CGC 9`, p))),
  judgeListing(zard([]), row(`Charizard 4/102 CGC 10 Pristine`, 300)),
];
const buckets = bucketByGrade(verdicts);
assert.deepEqual(buckets.map((b) => [b.label, b.count, b.median]), [
  ["CGC 10 Pristine", 1, 300], ["PSA 10", 3, 110], ["CGC 9", 3, 125], ["PSA 9", 3, 45],
]);

const advice = adviseOn(buckets, { rawCost: 30, sellFeePct: 10, gradingCost: { PSA: 25, CGC: 20 } });
assert.match(advice.sameGrade.join("\n"), /Grade 9: CGC \$125 · PSA \$45\.00\. CGC pays most — about 2\.8× more than PSA/);
assert.deepEqual(advice.crossGrade, ["CGC 9 ($125) sells for more than PSA 10 ($110)."]);
// PSA 9: 45*0.9-30-25 = -14.5 -> loses; PSA 10: 99-55 = 44 -> profit.
const psa9 = advice.outcomes.find((o) => o.label === "PSA 9");
assert.equal(psa9.net, -14.5);
assert.match(advice.breakEven.join("\n"), /PSA: profitable from PSA 10 up/);
assert.match(advice.breakEven.join("\n"), /CGC: profitable from CGC 9 up/);
assert.match(advice.verdict, /Worth grading if it gets 9 or better/);

const losing = adviseOn(buckets, { rawCost: 500, sellFeePct: 13, gradingCost: { PSA: 25, CGC: 20 } });
assert.match(losing.verdict, /^Not worth grading/);
assert.match(adviseOn([], { rawCost: 1, sellFeePct: 13, gradingCost: {} }).verdict, /No graded sales/);

console.log("TCG grading check: grade parsing, version matching and advice all pass.");

// ---- Cert numbers, repeat slabs, 30-day trend, expected profit ----
import { dropRepeatSlabs, parseCert } from "../lib/tcgGrading/listings.ts";
import { expectedFor, outcomesFor, oddsAreUsable } from "../lib/tcgGrading/advice.ts";
import { suggestPsaTier } from "../lib/tcgGrading/gradingFees.ts";

assert.equal(parseCert("Charizard 4/102 Base Set Holo PSA 9 cert 12345678"), "12345678");
assert.equal(parseCert("Charizard 4/102 PSA 10 #87654321 1999"), "87654321");
assert.equal(parseCert("Shanks OP01-120 CGC 10 4195432-001"), "4195432001");
assert.equal(parseCert("Shanks OP01-120 PSA 10 1999 Romance Dawn SWSH050"), null, "years and card codes are not certs");

const repeat = dropRepeatSlabs([
  judgeListing(zard([]), row("Charizard 4/102 PSA 9 cert 12345678", 500, { endedAt: "2026-09-01T00:00:00Z" })),
  judgeListing(zard([]), row("Charizard 4/102 PSA 9 cert 12345678", 560, { endedAt: "2026-10-15T00:00:00Z" })),
  judgeListing(zard([]), row("Charizard 4/102 PSA 9 cert 99999999", 520, { endedAt: "2026-10-01T00:00:00Z" })),
]);
assert.deepEqual(repeat.map((v) => v.used), [false, true, true]);
assert.match(repeat[0].reason, /same slab \(cert 12345678\)/);

const now = Date.parse("2026-11-16T00:00:00Z");
const trend = bucketByGrade([
  judgeListing(zard([]), row("Charizard 4/102 PSA 9", 100, { endedAt: "2026-08-25T00:00:00Z" })),
  judgeListing(zard([]), row("Charizard 4/102 PSA 9", 100, { endedAt: "2026-09-20T00:00:00Z" })),
  judgeListing(zard([]), row("Charizard 4/102 PSA 9", 80, { endedAt: "2026-11-01T00:00:00Z" })),
  judgeListing(zard([]), row("Charizard 4/102 PSA 9", 70, { endedAt: "2026-11-10T00:00:00Z" })),
], now);
assert.equal(trend[0].median, 90);
assert.equal(trend[0].recentCount, 2);
assert.equal(trend[0].recentMedian, 75);

assert.equal(oddsAreUsable({ 10: 60, 9: 30, 8: 10, 7: 0 }), true);
assert.equal(oddsAreUsable({ 10: 60, 9: 30, 8: 20, 7: 0 }), false);
const oddsCosts = { rawCost: 30, sellFeePct: 10, gradingCost: { PSA: 25, CGC: 20 }, gradeOdds: { 10: 50, 9: 40, 8: 10, 7: 0 } };
const expected = expectedFor(outcomesFor(buckets, oddsCosts), oddsCosts);
// PSA 10 net 44, PSA 9 net -14.5, PSA 8: no sales anywhere, so it sells at raw
// value: 30*0.9-30-25 = -28. 0.5*44 + 0.4*-14.5 + 0.1*-28 = 13.4.
const psa = expected.find((e) => e.company === "PSA");
assert.equal(psa.expectedNet, 13.4);
assert.equal(psa.coveredPct, 90);
assert.deepEqual(psa.missingGrades, [8]);
assert.equal(psa.used.find((u) => u.grade === 8).source, "raw value");
// CGC: no plain CGC 10 (only Pristine), so PSA 10 stands in: 69-20 = 49;
// CGC 9: 62.5; 8 at raw value: -23. 0.5*49 + 0.4*62.5 + 0.1*-23 = 47.2.
const cgc = expected.find((e) => e.company === "CGC");
assert.equal(cgc.expectedNet, 47.2);
assert.equal(cgc.coveredPct, 40);
assert.equal(cgc.used.find((u) => u.grade === 10).source, "other company");
// CGC looks better but only 40% is its own data: the verdict stays on PSA and says why.
const oddsAdvice = adviseOn(buckets, oddsCosts);
assert.match(oddsAdvice.verdict, /Worth grading at your odds: expected profit \$13\.40 per card with PSA/);
assert.match(oddsAdvice.warnings.join("\n"), /CGC shows a higher expected profit \(\$47\.20\)/);

// Thin data must not drive the verdict (live Umbreon VMAX 215/203, 17 Nov 2026:
// one BGS 10 at $6,100 made BGS look best while PSA had 22 PSA 10 sales).
const thinCase = bucketByGrade([
  judgeListing(zard([]), row("Charizard 4/102 BGS 10 Pristine", 6100)),
  ...[3400, 3500, 3600].map((p) => judgeListing(zard([]), row("Charizard 4/102 PSA 10", p))),
  ...[1850, 1900, 2000].map((p) => judgeListing(zard([]), row("Charizard 4/102 PSA 9", p))),
  ...[1200, 1900, 1950].map((p) => judgeListing(zard([]), row("Charizard 4/102 PSA 8", p))),
  ...[1500, 1600, 1800].map((p) => judgeListing(zard([]), row("Charizard 4/102 PSA 6", p))),
]);
const thinAdvice = adviseOn(thinCase, { rawCost: 2265, sellFeePct: 13, gradingCost: { PSA: 75, BGS: 75 }, gradeOdds: { 10: 30, 9: 45, 8: 20, 7: 5 } });
assert.match(thinAdvice.verdict, /with PSA/);
assert.match(thinAdvice.warnings.join("\n"), /BGS shows a higher expected profit/);

assert.equal(suggestPsaTier(110)?.name, "Value");
assert.equal(suggestPsaTier(800)?.name, "Regular");
assert.equal(suggestPsaTier(20000), null);

// ---- Typed "other version" ----
import { customVersion, customVersionWords } from "../lib/tcgGrading/cards.ts";
assert.deepEqual(customVersionWords("Magazine Promo"), ["magazine", "promo"]);
const typed = customVersion("ST21-014", "Magazine Promo", "onepiece");
assert.equal(typed.key, "ST21-014|custom:Magazine Promo");
const luffy = { game: "onepiece", name: "Monkey.D.Luffy", number: "ST21-014", variantTags: typed.variantTags, language: "japanese", mustMention: typed.mustMention };
assert.deepEqual(typed.variantTags, ["promo"]);
const luffyRows = [
  row("One Piece Monkey D Luffy ST21-014 Magazine Promo Japanese PSA 10", 400),
  row("One Piece Monkey D Luffy ST21-014 Japanese PSA 10", 60),
  row("Monkey D Luffy ST21-014 Promo Japan PSA 9", 50),
];
assert.deepEqual(usedTitles(luffy, luffyRows), ["One Piece Monkey D Luffy ST21-014 Magazine Promo Japanese PSA 10"]);
assert.match(judgeListing(luffy, luffyRows[1]).reason, /doesn't mention "magazine", "promo"/);
assert.equal(customVersion("ST21-014", "  ", "onepiece"), null);

// ---- eBay search terms per version ----
import { soldSearchKeyword } from "../lib/tcgGrading/cards.ts";
const opCard = { game: "onepiece", id: "ST21-014", name: "Monkey.D.Luffy", number: "ST21-014", setName: "Starter Deck EX: Gear 5", rarity: "SR", image: null, versions: [] };
const base = { key: "ST21-014|ST21-014", label: "Base", rawMarketUsd: 10.5, variantTags: [] };
const parallel = { key: "ST21-014|ST21-014_p1", label: "Parallel", rawMarketUsd: 30.41, variantTags: ["alt-art"] };
const promo = { key: "ST21-014|promo:ST21-014", label: "3rd Anniversary Treasure Campaign Pack (Promo)", rawMarketUsd: 1720.22, variantTags: ["foil-variant"] };
assert.equal(soldSearchKeyword({ card: opCard, version: base }), "Monkey.D.Luffy ST21-014 (PSA,CGC,BGS)");
assert.equal(soldSearchKeyword({ card: opCard, version: parallel }), 'Monkey.D.Luffy ST21-014 (parallel,"alt art","alternate art") (PSA,CGC,BGS)');
assert.equal(soldSearchKeyword({ card: opCard, version: promo }), "Monkey.D.Luffy ST21-014 (3rd,anniversary,treasure) (PSA,CGC,BGS)");
assert.equal(soldSearchKeyword({ card: opCard, version: typed }, "japanese"), "Monkey.D.Luffy ST21-014 magazine promo japanese (PSA,CGC,BGS)");
const pkCard = { ...opCard, game: "pokemon", id: "base1-4", name: "Charizard", number: "4/102" };
assert.equal(soldSearchKeyword({ card: pkCard, version: { key: "base1-4|1stEditionHolofoil", label: "1st Edition Holofoil", rawMarketUsd: null, variantTags: ["1st-edition"] } }),
  'Charizard 4/102 ("1st edition","first edition") (PSA,CGC,BGS)');

// ---- Live run 17 Nov 2026: titles that were wrongly counted ----
// Umbreon VMAX 215/203: German copies ("GER") counted as English.
const umbreon = { game: "pokemon", name: "Umbreon VMAX", number: "215", printedTotal: 203, variantTags: [], language: "english" };
assert.equal(judgeListing(umbreon, row("UMBREON VMAX POKEMON EVOLVING SKIES FA SECRET RARE GER 215/203 2021 PSA 8", 1215.17)).reason, "different language");
assert.equal(judgeListing(umbreon, row("Pokemon 2021 Umbreon VMAX 215/203 Alt Art Evolving Skies GEM MINT PSA 10", 3400)).used, true);

// OP05-119 Luffy, base version: SP, alt art, promo-set and OP09 reprints counted as base.
const gear5 = { game: "onepiece", name: "Monkey.D.Luffy", number: "OP05-119", variantTags: [], language: "english" };
const wrongForBase = {
  "2025 One Piece Monkey D. Luffy Special Card Alternative Art #OP05-119 PSA 10": /different version/,
  "2025 One Piece Monkey D. Luffy Special Card #OP05-119 PSA 9": /different version \(listing is sp\)/,
  "One Piece 2025 Promo Monkey.D.Luffy SEC OP05-119 EN 2nd Anniversary Set BGS 9.5": /different version \(listing is promo\)/,
  "MONKEY D. LUFFY 2025 ONE PIECE 2ND ANNIVERSARY SET OP05-119 SEC PSA 9 Q2029": /different version \(listing is promo\)/,
  "Psa Monkey.D.Luffy OP05-119 OP09-EMPERORS IN THE New WORLD [PSA 10]": /listing names set OP09/,
};
for (const [title, reason] of Object.entries(wrongForBase)) assert.match(judgeListing(gear5, row(title, 100)).reason, reason, title);
const rightForBase = [
  "Monkey D. Luffy OP05-119 SEC Gear5 One Piece OP-05 En PSA 10 💎",
  "PSA10 Monkey D. Luffy OP05-119 SEC Foil English 2023 One Piece TCG OG PRINT",
  "2023 One Piece OP05-119 Monkey D. Luffy PSA 10 Gem Mint #119 Awakening New Era",
  "One Piece 2023 Awakening New Era Monkey D. Luffy OP05-119 EN Foil PSA 9",
];
for (const title of rightForBase) assert.equal(judgeListing(gear5, row(title, 80)).used, true, title);
// The promo version itself still accepts listings that never say "promo".
const promoVersion = { ...gear5, variantTags: ["promo"] };
assert.equal(judgeListing(promoVersion, row("One Piece 2025 Promo Monkey.D.Luffy SEC OP05-119 EN 2nd Anniversary Set BGS 9.5", 27.56)).used, true);
// A Wanted Poster version is an OP09 reprint, so OP09 in its titles is fine.
const wanted = { ...gear5, variantTags: ["wanted"] };
assert.equal(judgeListing(wanted, row("2024 One Piece EN OP09 Monkey D. Luffy Wanted Poster OP05-119 PSA 10", 960)).used, true);

// ---- CompSniper rows (shapes from the live run, 17 Nov 2026) ----
import { toSoldRow, GRADING_MAX_CHARGE_USD, GRADING_RESULTS } from "../lib/tcgGrading/soldSearch.ts";
import { dropPriceOutliers } from "../lib/tcgGrading/listings.ts";
assert.equal(GRADING_RESULTS, 80);
assert.equal(GRADING_MAX_CHARGE_USD, 0.18);
const csBase = { itemId: "1", title: "Umbreon VMAX PSA 8 Evolving Skies 215/203 Holo Secret Rare Alt Art", url: "https://www.ebay.com/itm/1", endedAt: "2026-11-12", soldCurrency: "USD", thumbnailUrl: "https://i.ebayimg.com/images/g/x/s-l500.jpg" };
// Accepted offer with a found price: that price is used, not the asking price.
const paidRow = toSoldRow({ ...csBase, soldPrice: "1895.00", bestOfferAccepted: true, acceptedOfferPrice: "1825.00", acceptedOfferPriceStatus: "found" });
const paidVerdict = judgeListing(umbreon, paidRow);
assert.equal(paidVerdict.used, true);
assert.equal(paidVerdict.price, 1825);
assert.equal(paidVerdict.bestOffer, true);
assert.equal(paidVerdict.imageUrl, csBase.thumbnailUrl);
// Accepted offer, price not found or still pending: excluded with the reason.
for (const status of ["not_available", "pending"]) {
  const hidden = judgeListing(umbreon, toSoldRow({ ...csBase, soldPrice: "1649.99", bestOfferAccepted: true, acceptedOfferPrice: null, acceptedOfferPriceStatus: status }));
  assert.match(hidden.reason, /best offer accepted; the real price paid is hidden/);
}
// Plain sale.
assert.equal(judgeListing(umbreon, toSoldRow({ ...csBase, soldPrice: "1840.00", bestOfferAccepted: null })).price, 1840);

// Outliers: the real OP05-119 base PSA 10 set from CompSniper. $381.60 has no
// version word in its title but is ~6× the rest (an unlabelled alt art).
const baseTens = [85, 89.27, 53, 60, 59, 36.68, 61, 381.6, 125.27].map((p, i) =>
  judgeListing(gear5, row(`One Piece 2023 Monkey D. Luffy OP05-119 Awakening of the New Era PSA 10 #${i}`, p)));
const cleaned = dropPriceOutliers(baseTens);
assert.deepEqual(cleaned.filter((v) => !v.used).map((v) => v.price), [381.6]);
assert.match(cleaned.find((v) => v.price === 381.6).reason, /over 3× the other PSA 10 sales/);
// Under 4 sales in a grade: nothing is judged an outlier.
assert.equal(dropPriceOutliers(baseTens.slice(5, 8)).every((v) => v.used), true);
// Low outliers too.
assert.match(dropPriceOutliers([...baseTens.slice(0, 5), judgeListing(gear5, row("One Piece Monkey D. Luffy OP05-119 PSA 10 low", 9))]).find((v) => v.price === 9).reason, /under a third/);

// ---- Headline (the big number the result leads with) ----
assert.deepEqual(oddsAdvice.headline, { tone: "good", amount: 13.4, label: "expected per card with PSA, at your odds" });
assert.equal(thinAdvice.headline.label, "expected per card with PSA, at your odds");
assert.equal(losing.headline.tone, "bad");
assert.ok(losing.headline.amount < 0);
assert.deepEqual(adviseOn([], { rawCost: 1, sellFeePct: 13, gradingCost: {} }).headline, { tone: "thin", amount: null, label: "No graded sales found" });
const noOdds = adviseOn(buckets, { rawCost: 30, sellFeePct: 10, gradingCost: { PSA: 25, CGC: 20 } });
// Best plain result is the 1-sale CGC 10 Pristine: shown, but flagged as thin.
assert.equal(noOdds.headline.tone, "thin");
assert.match(noOdds.headline.label, /^if it gets CGC 10 Pristine/);

// ---- Pokémon via TCGdex (shapes from the live API, 25 Nov 2026) ----
import { parsePokemonSearch, tcgdexToPokemonCard } from "../lib/tcgGrading/cards.ts";
assert.deepEqual(parsePokemonSearch("dragonite 52/108"), { name: "dragonite", number: "52", printedTotal: 108 });
assert.deepEqual(parsePokemonSearch("4/102"), { name: "", number: "4", printedTotal: 102 });
assert.deepEqual(parsePokemonSearch("charizard ex 6"), { name: "charizard ex", number: "6", printedTotal: null });
assert.deepEqual(parsePokemonSearch("Umbreon VMAX"), { name: "Umbreon VMAX", number: null, printedTotal: null });

const dragonite = tcgdexToPokemonCard({
  id: "xy6-52", localId: "52", name: "Dragonite", image: "https://assets.tcgdex.net/en/xy/xy6/52", rarity: "Rare Holo",
  set: { id: "xy6", name: "Roaring Skies", cardCount: { official: 108, total: 112 } },
  variants: { firstEdition: false, holo: false, normal: true, reverse: false },
  pricing: { tcgplayer: { unit: "USD", updated: "2026-11-24T22:16:28Z", holofoil: { marketPrice: 29.7, midPrice: 31 }, "reverse-holofoil": { marketPrice: 30.66, midPrice: 32 } } },
});
assert.equal(dragonite.number, "52");
assert.equal(dragonite.set.printedTotal, 108);
assert.equal(dragonite.images.small, "https://assets.tcgdex.net/en/xy/xy6/52/low.webp");
assert.deepEqual(dragonite.tcgplayer.prices, { holofoil: { market: 29.7, mid: 31 }, reverseHolofoil: { market: 30.66, mid: 32 } });

// Neo Genesis Lugia: 1st Edition priced separately, zero-padded sv numbers shown plainly.
const lugia = tcgdexToPokemonCard({
  id: "neo1-9", localId: "9", name: "Lugia", set: { id: "neo1", name: "Neo Genesis", cardCount: { official: 111 } },
  variants: { firstEdition: true, holo: true }, pricing: { tcgplayer: { "1st-edition-holofoil": { marketPrice: 1300 }, "unlimited-holofoil": { marketPrice: 513.49 } } },
});
assert.deepEqual(Object.keys(lugia.tcgplayer.prices), ["1stEditionHolofoil", "unlimitedHolofoil"]);
assert.equal(tcgdexToPokemonCard({ id: "sv03.5-006", localId: "006", name: "Charizard ex", set: { id: "sv03.5", name: "151", cardCount: { official: 165 } } }).number, "6");
// A 0 price from the source means unknown, not free.
assert.equal(tcgdexToPokemonCard({ id: "x-1", localId: "1", name: "X", set: { id: "x", name: "X" }, pricing: { tcgplayer: { normal: { marketPrice: 0, midPrice: 0 } } } }).tcgplayer.prices.normal.market, null);

console.log("Cert dedupe, trend, odds, PSA tiers, typed versions, search terms, live-run regressions, CompSniper rows, outliers, headline and TCGdex mapping all pass.");
