// Turning eBay sold-listing titles into graded price evidence for ONE card.
//
// Pure functions only -- no network -- so the rules can be tested against real
// titles (scripts/test-tcg-grading.mjs).
//
// The hard part is not reading "PSA 10". It is that one card number covers
// cards worth wildly different amounts: OP01-120 Shanks sells for ~$50 in a
// PSA 10 slab as the base SEC and ~$4,500 as the Manga alt art; Charizard
// 4/102 is Base Set, Shadowless, 1st Edition, or a Celebrations reprint. So
// every listing is checked against the exact version the user picked, and
// anything that cannot be placed confidently is excluded *with a reason* that
// the user can see, rather than quietly averaged in.

export type Game = "pokemon" | "onepiece";

export const COMPANIES = ["PSA", "CGC", "BGS", "SGC", "TAG", "ACE"] as const;
export type Company = (typeof COMPANIES)[number];

export type SoldRow = {
  itemId?: string | null;
  title?: string | null;
  url?: string | null;
  endedAt?: string | null;
  soldPrice?: string | number | null;
  soldPriceMax?: string | number | null;
  soldCurrency?: string | null;
  isBestOfferAccepted?: boolean | null;
};

/** What the listing has to match. Built server-side from the card record. */
export type CardTarget = {
  game: Game;
  name: string;
  /** Pokémon: "4/102" style number check. One Piece: card id such as "OP01-120". */
  number: string;
  printedTotal?: number | null;
  /** Variant tags the listing MUST carry (and only these from the premium families). */
  variantTags: string[];
  /** Language the user's copy is in. */
  language: "english" | "japanese";
  /** Words the title must contain (typed "other version"). */
  mustMention?: string[];
};

export type Grade = { company: Company; grade: number; label: string };

export type ListingVerdict = {
  title: string;
  url: string | null;
  soldDate: string | null;
  price: number | null;
  grade: Grade | null;
  /** Slab certification number when the title shows one. */
  cert: string | null;
  used: boolean;
  reason: string;
};

const GRADE_NUM = "(10|[1-9](?:\\.5)?)";
const COMPANY_WORDS: Record<Company, string> = {
  PSA: "PSA",
  CGC: "CGC",
  BGS: "BGS|BECKETT",
  SGC: "SGC",
  TAG: "TAG",
  ACE: "ACE",
};
// Words a seller puts between the company and the number: "CGC Pristine 10",
// "BGS 9.5 Gem Mint", "PSA Gem Mint 10", "TAG graded 9".
const GAP = "(?:\\s*(?:pristine|perfect|gem\\s*mint|gem|mint|gm|nm|black\\s*label|gold\\s*label|graded|grade|universal|label)\\s*)*";

function companiesIn(title: string): Company[] {
  return COMPANIES.filter((company) => new RegExp(`\\b(?:${COMPANY_WORDS[company]})(?![a-z])`, "i").test(title));
}

/** The slab in a title, or null when there isn't exactly one readable grade. */
export function parseGrade(title: string): Grade | null {
  const companies = companiesIn(title);
  if (companies.length !== 1) return null;
  const company = companies[0];
  const word = COMPANY_WORDS[company];
  const after = new RegExp(`\\b(?:${word})(?![a-z])[\\s:#-]*${GAP}[\\s:#-]*${GRADE_NUM}(?![\\d./])`, "i").exec(title);
  const before = new RegExp(`(?<![\\d./])${GRADE_NUM}\\s*${GAP}\\s*(?:by\\s*)?\\b(?:${word})(?![a-z])`, "i").exec(title);
  const value = after?.[1] ?? before?.[1];
  if (!value) return null;
  const grade = Number(value);
  let label = `${company} ${value}`;
  // These are separate markets with very different prices from a plain 10.
  if (grade === 10 && company === "CGC" && /pristine/i.test(title)) label = "CGC 10 Pristine";
  if (grade === 10 && company === "BGS" && /black\s*label/i.test(title)) label = "BGS 10 Black Label";
  return { company, grade, label };
}

// Cert numbers: PSA 8 digits, SGC 7-8, BGS 10, CGC 10 (sometimes 7-3 with a
// dash). Anything shorter collides with card numbers and years.
const CERT = /(?:\bcert(?:ification|ificate)?\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*|#\s?)?\b(\d{7}-\d{3}|\d{8,10})\b/i;

/** The slab's cert number in a title, or null. */
export function parseCert(title: string): string | null {
  const match = CERT.exec(title);
  return match ? match[1].replace("-", "") : null;
}

// Titles that aren't a single, graded, ordinary copy of a card.
const NOT_A_GRADED_COPY: Array<[RegExp, string]> = [
  [/\b(?:pre-?grade|contender|candidate|ready\s+(?:to|for)\s+grad\w*|send\s+(?:to|for)\s+grad\w*|potential|gradable)\b/i, "not graded (a 'contender'/pregrade raw card)"],
  [/\b(?:ungraded|not\s+graded|raw)\b/i, "raw card mentioning a grader"],
  [/\b(?:lot|bundle|set\s+of|x\s?[2-9]\b|[2-9]\s?x\b|cards?\s+lot)\b/i, "multi-card lot"],
  [/\b(?:proxy|custom|orica|fan\s*art|fake|replica|metal\s+card|gold\s+card)\b/i, "not a genuine card"],
  [/\b(?:signed|autograph\w*|auto(?:\s+\d+)?)\b/i, "signed copy (separate market)"],
  [/\b(?:serial(?:ized|ised)?|top\s+prize|numbered\s*\/|\/\d+\s*serial)\b/i, "serialized prize card (separate market)"],
  [/\b(?:empty|slab\s+only|case\s+only|label\s+only|no\s+card)\b/i, "empty slab or label"],
  [/\b(?:miscut|misprint|error|off-?center\s+error|crimp)\b/i, "error card (separate market)"],
];

const OTHER_LANGUAGES = /\b(?:chinese|simplified|traditional|korean|kor|german|deutsch|french|fran[cç]ais|italian|italiano|spanish|espa[nñ]ol|portuguese|thai|indonesian)\b/i;
const JAPANESE = /\b(?:japanese|japan|jpn|jp|jap|japon)\b/i;
const ENGLISH = /\b(?:english|eng|en)\b/i;

// Variant families. A listing carrying a family tag the chosen card doesn't
// have (or missing one it does) is a different card for pricing purposes.
const POKEMON_TAGS: Array<[string, RegExp]> = [
  ["1st-edition", /\b(?:1st|first)\s*(?:ed(?:ition)?|ed\.)\b|\b1st\b/i],
  ["shadowless", /\bshadow\s*less\b/i],
  ["reverse-holo", /\b(?:reverse|rev)\s*holo\b|\brh\b/i],
  // Reprints that keep the original number.
  ["reprint", /\b(?:celebrations?|classic\s+collection|anniversary|25th|30th|evolutions|reprint|first\s+partner)\b/i],
];

const ONE_PIECE_TAGS: Array<[string, RegExp]> = [
  ["manga", /\b(?:manga|comic)\b/i],
  ["sp", /\bSP\b|\bspecial\s+(?:card|art|rare)\b/],
  ["wanted", /\bwanted\b/i],
  ["prb", /\bprb\s*-?\s*0?\d\b|\bpremium\s+booster\b|\bthe\s+best\b/i],
  ["alt-art", /\b(?:alt(?:ernate|\.)?\s*art|parallel|AA|par)\b/i],
  ["foil-variant", /\b(?:jolly\s+roger|pirate\s+foil|textured|full\s+art|box\s+topper|treasure|gold(?!\s*label)|silver|spr|tr)\b/i],
];

export function variantTagsIn(game: Game, title: string): string[] {
  const families = game === "pokemon" ? POKEMON_TAGS : ONE_PIECE_TAGS;
  const tags = families.filter(([, pattern]) => pattern.test(title)).map(([tag]) => tag);
  // Every Base Set 1st Edition is also shadowless; sellers often say both.
  if (game === "pokemon" && tags.includes("1st-edition")) return tags.filter((tag) => tag !== "shadowless");
  // A Manga or SP card is also an alt art -- sellers write both.
  // Manga is the top tier; sellers sometimes also call it "SP".
  if (game === "onepiece" && tags.includes("manga")) return tags.filter((tag) => tag !== "alt-art" && tag !== "sp");
  if (game === "onepiece" && (tags.includes("sp") || tags.includes("wanted"))) {
    return tags.filter((tag) => tag !== "alt-art");
  }
  return tags;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does the title name this card's number? Without it, it may be any print. */
export function mentionsCardNumber(target: CardTarget, title: string): boolean {
  if (target.game === "onepiece") {
    const match = /^([A-Z]+)(\d+)-(\d+)$/i.exec(target.number);
    if (!match) return new RegExp(`\\b${escapeRegExp(target.number)}\\b`, "i").test(title);
    const [, prefix, setNo, cardNo] = match;
    // OP01-120, OP1-120, OP01 120, OP01 #120, OP01-#120
    return new RegExp(`\\b${prefix}\\s*0*${Number(setNo)}\\s*[-#\\s]*\\s*#?0*${Number(cardNo)}\\b`, "i").test(title);
  }
  const numeric = /^\d+$/.test(target.number);
  if (numeric && target.printedTotal) {
    return new RegExp(`(?<![\\d])0*${Number(target.number)}\\s*/\\s*0*${target.printedTotal}(?![\\d])`).test(title);
  }
  // Promo / gallery numbers like SWSH050, TG05, SV049.
  return new RegExp(`\\b${escapeRegExp(target.number)}\\b`, "i").test(title);
}

function nameWords(name: string) {
  return name
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+-\s+.*$/, " ")
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.replace(/['’]s$/i, "").toLowerCase())
    .filter((word) => word.length > 1 && !["ex", "gx", "v", "vmax", "vstar"].includes(word));
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function judgeListing(target: CardTarget, row: SoldRow): ListingVerdict {
  const title = (row.title ?? "").trim();
  const price = toNumber(row.soldPrice);
  const base = {
    title,
    url: row.url ?? null,
    soldDate: row.endedAt ? row.endedAt.slice(0, 10) : null,
    price,
    grade: parseGrade(title),
    cert: parseCert(title),
  };
  const reject = (reason: string): ListingVerdict => ({ ...base, used: false, reason });

  if (!title) return reject("no title");
  if (!row.url) return reject("no link to the original listing");
  if (price === null) return reject("no sold price");
  if ((row.soldCurrency ?? "USD").toUpperCase() !== "USD") return reject(`priced in ${row.soldCurrency}, not USD`);
  const max = toNumber(row.soldPriceMax);
  if (max !== null && max !== price) return reject("multi-variation listing; the sold variation is unclear");
  if (row.isBestOfferAccepted) return reject("best offer accepted; the real price paid is hidden");

  for (const [pattern, reason] of NOT_A_GRADED_COPY) {
    if (pattern.test(title)) return reject(reason);
  }
  if (companiesIn(title).length > 1) return reject("names more than one grading company");
  if (!base.grade) return reject("no readable grading company + grade");

  const words = nameWords(target.name);
  const lower = title.toLowerCase();
  if (words.length && !words.every((word) => lower.includes(word))) return reject("card name doesn't match");
  if (!mentionsCardNumber(target, title)) return reject(`doesn't show card number ${target.number}`);
  const unmentioned = (target.mustMention ?? []).filter((word) => !lower.includes(word));
  if (unmentioned.length) return reject(`doesn't mention "${unmentioned.join('", "')}"`);

  if (OTHER_LANGUAGES.test(title)) return reject("different language");
  const isJapanese = JAPANESE.test(title) && !ENGLISH.test(title);
  if (target.language === "english" && isJapanese) return reject("Japanese copy");
  if (target.language === "japanese" && !JAPANESE.test(title)) return reject("not marked as Japanese");

  const tags = variantTagsIn(target.game, title);
  const missing = target.variantTags.filter((tag) => !tags.includes(tag));
  const extra = tags.filter((tag) => !target.variantTags.includes(tag));
  if (missing.length || extra.length) {
    const parts = [
      extra.length ? `listing is ${extra.join(", ")}` : "",
      missing.length ? `listing isn't ${missing.join(", ")}` : "",
    ].filter(Boolean);
    return reject(`different version (${parts.join("; ")})`);
  }

  return { ...base, used: true, reason: "matches" };
}

/**
 * The same slab sold twice (relisted, or flipped) is one card, not two data
 * points. Keep the most recent sale; mark the earlier ones excluded.
 */
export function dropRepeatSlabs(verdicts: ListingVerdict[]): ListingVerdict[] {
  const latest = new Map<string, ListingVerdict>();
  for (const verdict of verdicts) {
    if (!verdict.used || !verdict.cert) continue;
    const current = latest.get(verdict.cert);
    if (!current || (verdict.soldDate ?? "") > (current.soldDate ?? "")) latest.set(verdict.cert, verdict);
  }
  return verdicts.map((verdict) => {
    if (!verdict.used || !verdict.cert || latest.get(verdict.cert) === verdict) return verdict;
    return { ...verdict, used: false, reason: `same slab (cert ${verdict.cert}) sold again later; counted once` };
  });
}

export const RECENT_DAYS = 30;

export type GradeBucket = {
  label: string;
  company: Company;
  grade: number;
  count: number;
  median: number;
  low: number;
  high: number;
  latest: string | null;
  /** Sales in the last RECENT_DAYS. */
  recentCount: number;
  /** Median of those, or null when there are none. */
  recentMedian: number | null;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function bucketByGrade(verdicts: ListingVerdict[], now = Date.now()): GradeBucket[] {
  const recentSince = new Date(now - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const groups = new Map<string, ListingVerdict[]>();
  for (const verdict of verdicts) {
    if (!verdict.used || !verdict.grade || verdict.price === null) continue;
    const list = groups.get(verdict.grade.label) ?? [];
    list.push(verdict);
    groups.set(verdict.grade.label, list);
  }
  const buckets = [...groups.values()].map((list): GradeBucket => {
    const prices = list.map((item) => item.price as number);
    const grade = list[0].grade as Grade;
    const recent = list.filter((item) => item.soldDate && item.soldDate >= recentSince).map((item) => item.price as number);
    return {
      label: grade.label,
      company: grade.company,
      grade: grade.grade,
      count: list.length,
      median: Math.round(median(prices) * 100) / 100,
      low: Math.min(...prices),
      high: Math.max(...prices),
      latest: list.map((item) => item.soldDate ?? "").sort().at(-1) || null,
      recentCount: recent.length,
      recentMedian: recent.length ? Math.round(median(recent) * 100) / 100 : null,
    };
  });
  return buckets.sort((a, b) => b.grade - a.grade || b.median - a.median);
}
