// Dev only: live Pokémon card searches against TCGdex.
//   node --experimental-strip-types scripts/dev-check-pokemon.mts "dragonite 52/108" "4/102" ...
import { resolveVersion, searchCards, soldSearchKeyword } from "../lib/tcgGrading/cards.ts";

for (const query of process.argv.slice(2)) {
  const started = Date.now();
  try {
    const cards = await searchCards("pokemon", query);
    console.log(`\n"${query}" -> ${cards.length} cards in ${Date.now() - started} ms`);
    for (const c of cards.slice(0, 6)) {
      console.log(`  ${c.id.padEnd(14)} ${c.name} ${c.number} · ${c.setName} · ${c.versions.map((v) => `${v.label}${v.rawMarketUsd != null ? ` $${v.rawMarketUsd}` : ""}`).join(" | ")} · img ${c.image ? "yes" : "no"}`);
    }
    if (cards[0]) {
      const resolved = await resolveVersion("pokemon", cards[0].versions[0].key);
      console.log(`  resolve ${cards[0].versions[0].key} -> ${resolved?.version.label} · eBay: ${resolved && soldSearchKeyword(resolved)}`);
    }
  } catch (error) {
    console.log(`\n"${query}" FAILED: ${(error as Error).message}`);
  }
}
