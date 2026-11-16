// Dev only: live card-source check that every list is merged for one ID.
//   node --experimental-strip-types scripts/dev-check-st21.mts
import { resolveVersion, searchCards, soldSearchKeyword } from "../lib/tcgGrading/cards.ts";

const [card] = await searchCards("onepiece", "ST21-014");
console.log(card.name, card.versions.map((v) => `${v.key} = ${v.label} $${v.rawMarketUsd}`));
const promo = await resolveVersion("onepiece", "ST21-014|promo:ST21-014");
console.log("promo resolve:", promo?.version.label);
const typed = await resolveVersion("onepiece", "ST21-014|custom:Magazine Promo");
console.log("typed resolve:", typed?.version.label, typed && soldSearchKeyword(typed, "japanese"));
const old = await resolveVersion("onepiece", "ST21-014|ST21-014_p1");
console.log("old key still works:", old?.version.label);
