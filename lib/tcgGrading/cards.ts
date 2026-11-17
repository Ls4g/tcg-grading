// Card lookup for the grading tool.
//
// Pokémon: api.pokemontcg.io (English cards, TCGplayer market prices per print).
// One Piece: optcgapi.com (English cards, TCGplayer market price per version).
//
// Every version the user can choose (1st Edition, Reverse Holo, Manga alt art,
// ...) becomes a `CardVersion` with its own raw price and its own variant tags,
// so graded sales are only ever compared against the same version.

import { variantTagsIn, type CardTarget, type Game } from "./listings.ts";

export type CardVersion = {
  /** Stable key the client sends back: "<cardId>|<variantKey>". */
  key: string;
  label: string;
  /** TCGplayer market price for a raw copy, USD. Null when not listed. */
  rawMarketUsd: number | null;
  variantTags: string[];
  /** Words a listing must contain (user-typed "other version"). */
  mustMention?: string[];
};

export const CUSTOM_VERSION_PREFIX = "custom:";
const CUSTOM_MAX = 40;

/** "Magazine Promo" -> ["magazine", "promo"]; words that must appear in a title. */
export function customVersionWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1))].slice(0, 6);
}

/** A version the card source doesn't list (e.g. a Japanese-only magazine promo). */
export function customVersion(cardId: string, text: string, game: Game): CardVersion | null {
  const label = text.trim().slice(0, CUSTOM_MAX);
  const words = customVersionWords(label);
  if (!words.length) return null;
  return {
    key: `${cardId}|${CUSTOM_VERSION_PREFIX}${label}`,
    label: `${label} (typed)`,
    rawMarketUsd: null,
    variantTags: variantTagsIn(game, label),
    mustMention: words,
  };
}

export type CardResult = {
  game: Game;
  id: string;
  name: string;
  number: string;
  setName: string;
  rarity: string | null;
  image: string | null;
  versions: CardVersion[];
};

const POKEMON_API = "https://api.pokemontcg.io/v2";
const OPTCG_API = "https://optcgapi.com/api";

async function getJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (url.startsWith(POKEMON_API) && process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;
  let lastStatus = 0;
  // pokemontcg.io returns the odd 500/504 under load; one retry clears most.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { headers, cache: "no-store" });
    if (response.ok) return (await response.json()) as T;
    lastStatus = response.status;
    if (response.status < 500) break;
  }
  throw new Error(`Card lookup failed (HTTP ${lastStatus}).`);
}

// ---------- Pokémon ----------

type PokemonPrice = { market?: number | null; mid?: number | null };
type PokemonCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: { id: string; name: string; printedTotal?: number; releaseDate?: string };
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, PokemonPrice> };
};

const POKEMON_PRINT_LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holo",
  reverseHolofoil: "Reverse Holo",
  "1stEditionHolofoil": "1st Edition Holo",
  "1stEditionNormal": "1st Edition",
  unlimitedHolofoil: "Unlimited Holo",
  unlimited: "Unlimited",
  "1stEdition": "1st Edition",
};

function pokemonPrintTags(printKey: string) {
  if (printKey === "shadowless") return ["shadowless"];
  if (/^1stEdition/.test(printKey)) return ["1st-edition"];
  if (printKey === "reverseHolofoil") return ["reverse-holo"];
  return [];
}

function pokemonVersions(card: PokemonCard): CardVersion[] {
  const prices = card.tcgplayer?.prices ?? {};
  const setTags = variantTagsIn("pokemon", card.set.name).filter((tag) => tag === "reprint");
  const keys = Object.keys(prices);
  const versions = keys.map((printKey): CardVersion => ({
    key: `${card.id}|${printKey}`,
    label: POKEMON_PRINT_LABELS[printKey] ?? printKey,
    rawMarketUsd: prices[printKey]?.market ?? prices[printKey]?.mid ?? null,
    variantTags: [...pokemonPrintTags(printKey), ...setTags],
  }));
  // Base Set's Shadowless print isn't priced separately on TCGplayer but is a
  // very different market, so it has to be choosable.
  if (card.set.id === "base1") {
    versions.push({ key: `${card.id}|shadowless`, label: "Shadowless", rawMarketUsd: null, variantTags: ["shadowless"] });
  }
  // WotC-era sets (1999–2002) had 1st Edition prints that TCGplayer often
  // doesn't list separately -- and they're usually the most valuable to grade.
  const year = Number(card.set.releaseDate?.slice(0, 4));
  if (year && year <= 2002 && !keys.some((key) => key.startsWith("1stEdition"))) {
    for (const version of versions) {
      if (!version.variantTags.length) version.label = `Unlimited ${version.label}`.replace("Unlimited Unlimited", "Unlimited");
    }
    versions.push({ key: `${card.id}|1stEdition`, label: "1st Edition", rawMarketUsd: null, variantTags: ["1st-edition"] });
  }
  if (!versions.length) versions.push({ key: `${card.id}|standard`, label: "Standard", rawMarketUsd: null, variantTags: setTags });
  return versions;
}

function toPokemonResult(card: PokemonCard): CardResult {
  return {
    game: "pokemon",
    id: card.id,
    name: card.name,
    number: card.set.printedTotal && /^\d+$/.test(card.number) ? `${card.number}/${card.set.printedTotal}` : card.number,
    setName: card.set.name,
    rarity: card.rarity ?? null,
    image: card.images?.small ?? null,
    versions: pokemonVersions(card),
  };
}

const POKEMON_FIELDS = "id,name,number,rarity,set,images,tcgplayer";

/** "charizard", "charizard 4/102", "pikachu 25", "umbreon vmax evolving skies" */
export function pokemonQuery(input: string): string {
  const parts: string[] = [];
  let rest = input.trim();
  const slash = /(\S+)\s*\/\s*(\d+)/.exec(rest);
  if (slash) {
    parts.push(`number:"${slash[1].replace(/^0+(?=\d)/, "")}"`, `set.printedTotal:${Number(slash[2])}`);
    rest = rest.replace(slash[0], " ");
  } else {
    const loneNumber = /(?:^|\s)#?([A-Za-z]{0,4}\d{1,3})(?=\s|$)/.exec(rest);
    if (loneNumber && /\d/.test(loneNumber[1])) {
      parts.push(`number:"${loneNumber[1].replace(/^0+(?=\d)/, "")}"`);
      rest = rest.replace(loneNumber[0], " ");
    }
  }
  const words = rest.replace(/["*:()]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length) parts.push(`name:"${words.join(" ")}*"`);
  return parts.join(" ");
}

export async function searchPokemon(input: string): Promise<CardResult[]> {
  const q = pokemonQuery(input);
  if (!q) return [];
  const url = `${POKEMON_API}/cards?q=${encodeURIComponent(q)}&pageSize=30&orderBy=-set.releaseDate&select=${POKEMON_FIELDS}`;
  const data = await getJson<{ data?: PokemonCard[] }>(url);
  return (data.data ?? []).map(toPokemonResult);
}

async function getPokemonCard(id: string): Promise<CardResult | null> {
  if (!/^[a-z0-9.-]+-[A-Za-z0-9]+$/i.test(id)) return null;
  const data = await getJson<{ data?: PokemonCard }>(`${POKEMON_API}/cards/${encodeURIComponent(id)}?select=${POKEMON_FIELDS}`);
  return data.data ? toPokemonResult(data.data) : null;
}

// ---------- One Piece ----------

type OnePieceRow = {
  endpoint?: OpEndpoint;
  card_name: string;
  card_set_id: string;
  card_image_id: string;
  set_name: string;
  rarity: string | null;
  market_price: number | null;
  card_image: string | null;
};

const OP_ID = /^(?:OP|ST|EB|PRB)\d{1,2}-\d{3}$|^P-\d{3}$/i;

const OP_ENDPOINTS = ["sets", "decks", "promos"] as const;
type OpEndpoint = (typeof OP_ENDPOINTS)[number];

/** Every list that can hold this ID. A deck card can also be a promo reprint. */
async function opRowsFor(id: string): Promise<Array<OnePieceRow & { endpoint: OpEndpoint }>> {
  const lists = await Promise.all(
    OP_ENDPOINTS.map(async (endpoint) => {
      const rows = await getJson<OnePieceRow[] | { error?: string }>(`${OPTCG_API}/${endpoint}/card/${id}/`).catch(() => []);
      return Array.isArray(rows) ? rows.map((row) => ({ ...row, endpoint })) : [];
    }),
  );
  return lists.flat();
}

/** "Shanks (Parallel) (Manga) (Alternate Art)" -> "Manga Alternate Art" */
function opVersionLabel(row: OnePieceRow) {
  const bits = [...row.card_name.matchAll(/\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((bit) => !/^\d{3}$/.test(bit) && !OP_ID.test(bit));
  const label = bits.length ? bits.join(" · ") : "Base";
  if (/premium booster/i.test(row.set_name)) return `${label} (${row.set_name})`;
  return row.endpoint === "promos" && !/promo/i.test(label) ? `${label} (Promo)` : label;
}

function opBaseName(name: string) {
  return name.replace(/\s+-\s+.*$/, "").replace(/\(.*?\)/g, "").trim();
}

/** Promo rows reuse the base image id, so they get their own key space. */
function opVersionKey(row: OnePieceRow) {
  return `${row.card_set_id}|${row.endpoint === "promos" ? "promo:" : ""}${row.card_image_id}`;
}

function groupOnePiece(rows: OnePieceRow[]): CardResult[] {
  const byCard = new Map<string, OnePieceRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.card_set_id || !row.card_image_id) continue;
    const key = opVersionKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byCard.get(row.card_set_id) ?? [];
    list.push(row);
    byCard.set(row.card_set_id, list);
  }
  return [...byCard.entries()].map(([cardId, list]) => {
    const original = list.find((row) => row.card_image_id === cardId && row.endpoint !== "promos") ?? list[0];
    return {
      game: "onepiece" as const,
      id: cardId,
      name: opBaseName(original.card_name),
      number: cardId,
      setName: original.set_name,
      rarity: original.rarity,
      image: original.card_image,
      versions: list.map((row): CardVersion => ({
        key: opVersionKey(row),
        label: opVersionLabel(row),
        rawMarketUsd: row.market_price ?? null,
        // Version tags come from the name *and* the set: a Premium Booster
        // reprint is a different market from the original-set card.
        variantTags: variantTagsIn("onepiece", `${row.card_name} ${row.set_name}`),
      })),
    };
  });
}

export async function searchOnePiece(input: string): Promise<CardResult[]> {
  const trimmed = input.trim();
  const idMatch = /\b((?:OP|ST|EB|PRB)\d{1,2}-\d{3}|P-\d{3})\b/i.exec(trimmed);
  if (idMatch) return groupOnePiece(await opRowsFor(idMatch[1].toUpperCase()));
  const name = trimmed.replace(/[^\p{L}\p{N}\s.'-]/gu, " ").trim();
  if (name.length < 2) return [];
  const results = await Promise.all(
    OP_ENDPOINTS.map(async (endpoint) => {
      const rows = await getJson<OnePieceRow[]>(`${OPTCG_API}/${endpoint}/filtered/?card_name=${encodeURIComponent(name)}`).catch(() => [] as OnePieceRow[]);
      return Array.isArray(rows) ? rows.map((row) => ({ ...row, endpoint })) : [];
    }),
  );
  return groupOnePiece(results.flat()).slice(0, 40);
}

async function getOnePieceCard(cardId: string): Promise<CardResult | null> {
  if (!OP_ID.test(cardId)) return null;
  const id = cardId.toUpperCase();
  return groupOnePiece(await opRowsFor(id)).find((card) => card.id === id) ?? null;
}

// ---------- Shared ----------

export async function searchCards(game: Game, input: string) {
  return game === "pokemon" ? searchPokemon(input) : searchOnePiece(input);
}

export type ResolvedVersion = { card: CardResult; version: CardVersion };

/** Re-reads the card from its source, so the client can't steer the search. */
export async function resolveVersion(game: Game, versionKey: string): Promise<ResolvedVersion | null> {
  const separator = versionKey.indexOf("|");
  const cardId = separator === -1 ? versionKey : versionKey.slice(0, separator);
  const variant = separator === -1 ? "" : versionKey.slice(separator + 1);
  if (!cardId) return null;
  const card = game === "pokemon" ? await getPokemonCard(cardId) : await getOnePieceCard(cardId);
  if (!card) return null;
  const version = variant.startsWith(CUSTOM_VERSION_PREFIX)
    ? customVersion(card.id, variant.slice(CUSTOM_VERSION_PREFIX.length), game)
    : card.versions.find((item) => item.key === versionKey);
  return version ? { card, version } : null;
}

export function targetFor(resolved: ResolvedVersion, language: "english" | "japanese"): CardTarget {
  const { card, version } = resolved;
  const [number, printedTotal] = card.game === "pokemon" && card.number.includes("/")
    ? [card.number.split("/")[0], Number(card.number.split("/")[1])]
    : [card.number, null];
  return { game: card.game, name: card.name, number, printedTotal, variantTags: version.variantTags, language, mustMention: version.mustMention ?? [] };
}

/** One eBay search covering every grader: eBay treats (a,b,c) as OR. */
// How sellers write each variant family in a title. eBay treats ("a","b") as
// OR, so one group per family keeps every spelling in the net.
const TAG_SEARCH_TERMS: Record<string, string[]> = {
  "alt-art": ["parallel", "alt art", "alternate art"],
  manga: ["manga", "comic"],
  sp: ["SP"],
  wanted: ["wanted"],
  prb: ["premium booster", "the best"],
  "1st-edition": ["1st edition", "first edition"],
  shadowless: ["shadowless"],
  "reverse-holo": ["reverse holo", "reverse"],
  reprint: ["celebrations", "classic collection", "anniversary"],
};
const LABEL_STOP_WORDS = new Set(["promo", "pack", "card", "cards", "set", "the", "and", "of", "vol", "version", "edition", "base", "typed"]);

function orGroup(terms: string[]) {
  return terms.map((term) => (term.includes(" ") ? `"${term}"` : term)).join(",");
}

/** Extra eBay terms that pull this version's sales to the top of the 40. */
export function versionSearchTerms(version: CardVersion, language: "english" | "japanese"): string[] {
  const terms: string[] = [];
  if (version.mustMention?.length) terms.push(...version.mustMention);
  for (const tag of version.variantTags) {
    const spellings = TAG_SEARCH_TERMS[tag];
    if (spellings) terms.push(orGroup(spellings));
  }
  // Promo / special-set versions carry their identity in the label, not a tag.
  if (!version.mustMention?.length && /promo|\(.*\)/i.test(version.label)) {
    const words = version.label
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !LABEL_STOP_WORDS.has(word))
      .slice(0, 3);
    if (words.length) terms.push(orGroup(words));
  }
  if (language === "japanese") terms.push("japanese");
  return [...new Set(terms)];
}

/**
 * One eBay search covering every grader. The base version searches by name
 * and number alone; any other version adds its own words, because eBay only
 * returns the most recent 40 and a cheap base copy sells far more often.
 */
export function soldSearchKeyword(resolved: ResolvedVersion, language: "english" | "japanese" = "english") {
  const { card, version } = resolved;
  const name = card.name.replace(/[()"]/g, " ").replace(/\s+/g, " ").trim();
  const extra = versionSearchTerms(version, language);
  return `${name} ${card.number}${extra.length ? ` ${extra.join(" ")}` : ""} PSA,CGC,BGS`;
}
