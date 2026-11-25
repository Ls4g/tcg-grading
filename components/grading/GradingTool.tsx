"use client";
/* eslint-disable @next/next/no-img-element -- card images come from the card APIs' own CDNs */

import { useEffect, useMemo, useState } from "react";
import { adviseOn, ODDS_GRADES, oddsAreUsable, outcomesFor, scenariosFor, type CostInputs, type GradeOdds, type OddsGrade } from "@/lib/tcgGrading/advice";
import { customVersion, type CardResult, type CardVersion } from "@/lib/tcgGrading/cards";
import { PSA_FEES_AS_OF, PSA_TIERS, suggestPsaTier } from "@/lib/tcgGrading/gradingFees";
import type { Company, Game, ListingVerdict } from "@/lib/tcgGrading/listings";
import type { PriceResult } from "@/lib/tcgGrading/price";

type Language = "english" | "japanese";
type BatchItem = { game: Game; versionKey: string; language: Language; cardName: string; number: string; versionLabel: string; rawMarketUsd: number | null };
type BatchRow = BatchItem & ({ ok: true; result: PriceResult } | { ok: false; error: string });

const COST_STORAGE_KEY = "tcg-grading-costs";
const ODDS_STORAGE_KEY = "tcg-grading-odds";
const BATCH_STORAGE_KEY = "tcg-grading-batch";
const BATCH_MAX = 10;
// Brand-ish colours, used only as small markers next to each company.
const COMPANY_COLORS: Partial<Record<Company, string>> = { PSA: "#d6252a", CGC: "#1f5fbf", BGS: "#9a7b2f", SGC: "#1d1d1f", TAG: "#6b46c1", ACE: "#0f8b8d" };
const TILE_LIMIT = 40;
const COST_PER_LOOKUP_USD = 0.16;

const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 })}`;
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;

const ODDS_PRESETS: Array<{ name: string; hint: string; odds: GradeOdds }> = [
  { name: "Pack fresh", hint: "Straight from the pack into a sleeve. Centred, no marks even under a light.", odds: { 10: 60, 9: 30, 8: 10, 7: 0 } },
  { name: "Looks clean", hint: "No wear you can see at arm's length, but you haven't checked closely or it's slightly off-centre.", odds: { 10: 30, 9: 45, 8: 20, 7: 5 } },
  { name: "Played", hint: "Some whitening on the edges, light scratches, or it has been in a binder or deck.", odds: { 10: 5, 9: 30, 8: 40, 7: 25 } },
];
// Where to check current grading prices (we don't guess them for CGC/BGS).
const GRADER_PRICE_LINKS: Partial<Record<Company, string>> = {
  CGC: "https://www.cgccards.com/submit/",
  BGS: "https://www.beckett.com/grading",
};
const EMPTY_ODDS: Record<OddsGrade, string> = { 10: "", 9: "", 8: "", 7: "" };

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toOdds(text: Record<OddsGrade, string>): GradeOdds | null {
  if (ODDS_GRADES.every((grade) => text[grade].trim() === "")) return null;
  return Object.fromEntries(ODDS_GRADES.map((grade) => [grade, numberOrNull(text[grade]) ?? 0])) as unknown as GradeOdds;
}

export default function GradingTool() {
  const [game, setGame] = useState<Game>("pokemon");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [card, setCard] = useState<CardResult | null>(null);
  const [versionKey, setVersionKey] = useState("");
  const [language, setLanguage] = useState<Language>("english");
  const [customText, setCustomText] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [sales, setSales] = useState<PriceResult | null>(null);
  const [pricing, setPricing] = useState(false);
  const [pricingSeconds, setPricingSeconds] = useState(0);
  const [numbersOpen, setNumbersOpen] = useState(true);
  const [error, setError] = useState("");

  const [rawCost, setRawCost] = useState("");
  const [sellFeePct, setSellFeePct] = useState("13");
  const [gradingCost, setGradingCost] = useState<Partial<Record<Company, string>>>({});
  const [oddsText, setOddsText] = useState<Record<OddsGrade, string>>(EMPTY_ODDS);

  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchError, setBatchError] = useState("");

  // Saved per-viewer preferences load once after mount (the server has no localStorage).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored) return;
    const costs = readJson<{ sellFeePct?: number; gradingCost?: Record<string, number | null> }>(COST_STORAGE_KEY);
    const odds = readJson<Record<OddsGrade, string>>(ODDS_STORAGE_KEY);
    const saved = readJson<BatchItem[]>(BATCH_STORAGE_KEY);
    // One frame later so the eslint rule's "setState in effect" cascade warning
    // doesn't apply; this is a deliberate hydrate-from-storage step.
    const frame = requestAnimationFrame(() => {
      if (costs) {
        setSellFeePct(String(costs.sellFeePct ?? 13));
        setGradingCost(Object.fromEntries(Object.entries(costs.gradingCost ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])));
      }
      if (odds) setOddsText({ ...EMPTY_ODDS, ...odds });
      if (Array.isArray(saved)) setBatch(saved.slice(0, BATCH_MAX));
      setRestored(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [restored]);

  useEffect(() => {
    if (!restored) return;
    writeJson(COST_STORAGE_KEY, {
      sellFeePct: Number(sellFeePct) || 0,
      gradingCost: Object.fromEntries(Object.entries(gradingCost).map(([k, v]) => [k, numberOrNull(v ?? "")])),
    });
  }, [restored, sellFeePct, gradingCost]);
  useEffect(() => { if (restored) writeJson(ODDS_STORAGE_KEY, oddsText); }, [restored, oddsText]);
  useEffect(() => { if (restored) writeJson(BATCH_STORAGE_KEY, batch); }, [restored, batch]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true); setError(""); setCards(null); setCard(null); setSales(null);
    try {
      const response = await fetch(`/api/cards?game=${game}&q=${encodeURIComponent(query.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Search failed.");
      setCards(data.cards);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function pickCard(next: CardResult, version: CardVersion | undefined = next.versions[0]) {
    setCard(next);
    setSales(null);
    setError("");
    setCustomOpen(false);
    setCustomText("");
    setVersionKey(version?.key ?? "");
    setRawCost(version?.rawMarketUsd != null && language === "english" ? String(version.rawMarketUsd) : "");
  }

  function pickVersion(version: CardVersion) {
    setVersionKey(version.key);
    setSales(null);
    setCustomOpen(false);
    setRawCost(version.rawMarketUsd != null && language === "english" ? String(version.rawMarketUsd) : "");
  }

  const typedVersion = card && customOpen ? customVersion(card.id, customText, card.game) : null;
  function applyTypedVersion() {
    if (!typedVersion) return;
    setVersionKey(typedVersion.key);
    setSales(null);
    setRawCost("");
  }

  useEffect(() => {
    if (!pricing) return;
    const started = Date.now();
    const timer = setInterval(() => setPricingSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pricing]);

  async function getPrices() {
    if (!card || !versionKey) return;
    setPricing(true); setPricingSeconds(0); setError(""); setSales(null);
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: card.game, versionKey, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Price search failed.");
      setSales(data);
      // Numbers already set: fold them away so the answer is what you see.
      if (oddsAreUsable(toOdds(oddsText)) && Object.values(gradingCost).some((v) => numberOrNull(v ?? "") != null)) setNumbersOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Price search failed.");
    } finally {
      setPricing(false);
    }
  }

  // One Piece versions have their own artwork (parallel, promo...), so each
  // gets its own tile; Pokémon prints share one image, so one tile per card.
  const resultTiles = useMemo(() => (cards ?? []).flatMap((item) =>
    item.versions.some((v) => v.image)
      ? item.versions.map((version) => ({ item, version }))
      : [{ item, version: null as CardVersion | null }]), [cards]);

  const selectedVersion = card?.versions.find((v) => v.key === versionKey) ?? (typedVersion?.key === versionKey ? typedVersion : null);
  const inBatch = batch.some((item) => item.versionKey === versionKey && item.language === language);

  function addToBatch() {
    if (!card || !selectedVersion || inBatch || batch.length >= BATCH_MAX) return;
    setBatch((prev) => [...prev, {
      game: card.game, versionKey, language, cardName: card.name, number: card.number,
      versionLabel: selectedVersion.label, rawMarketUsd: language === "english" ? selectedVersion.rawMarketUsd : null,
    }]);
    setBatchRows(null);
  }

  async function runBatch() {
    if (!batch.length) return;
    setBatchRunning(true); setBatchError(""); setBatchRows(null);
    try {
      const response = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch.map(({ game, versionKey, language }) => ({ game, versionKey, language })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Batch failed.");
      const results = data.results as Array<{ ok: true; result: PriceResult } | { ok: false; error: string }>;
      setBatchRows(batch.map((item, index) => ({ ...item, ...results[index] })));
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Batch failed.");
    } finally {
      setBatchRunning(false);
    }
  }

  const gradeOdds = useMemo(() => toOdds(oddsText), [oddsText]);
  const oddsTotal = ODDS_GRADES.reduce((sum, grade) => sum + (numberOrNull(oddsText[grade]) ?? 0), 0);

  const costs: CostInputs = useMemo(() => ({
    rawCost: numberOrNull(rawCost) ?? 0,
    sellFeePct: numberOrNull(sellFeePct) ?? 0,
    gradingCost: Object.fromEntries(Object.entries(gradingCost).map(([k, v]) => [k, numberOrNull(v ?? "")])),
    gradeOdds,
  }), [rawCost, sellFeePct, gradingCost, gradeOdds]);

  const advice = useMemo(() => (sales ? adviseOn(sales.buckets, costs) : null), [sales, costs]);
  // Grading costs can be entered before the lookup; any other company that
  // turns up in the sales gets its own box too.
  const costCompanies = useMemo(() => [...new Set<Company>(["PSA", "CGC", "BGS", ...(sales?.buckets.map((b) => b.company) ?? [])])], [sales]);
  const used = useMemo(() => sales?.listings.filter((l) => l.used) ?? [], [sales]);
  const excluded = sales?.listings.filter((l) => !l.used) ?? [];
  // eBay returns the newest 40 only; for a popular card that can be days, not 90.
  // One card per company: expected profit at the user's odds, else the best
  // plain grade. Sorted best first.
  const companyCards = useMemo(() => {
    if (!advice) return [];
    if (advice.expected.length) {
      return advice.expected.map((e) => ({ company: e.company, amount: e.expectedNet, basis: "expected per card at your odds", thin: e.thinPct >= 30 || e.coveredPct < 50 }));
    }
    const byCompany = new Map<Company, (typeof advice.outcomes)[number]>();
    for (const o of advice.outcomes) {
      if (o.label !== `${o.company} ${o.grade}`) continue;
      const current = byCompany.get(o.company);
      if (!current || (o.net ?? o.uplift) > (current.net ?? current.uplift)) byCompany.set(o.company, o);
    }
    return [...byCompany.values()]
      .map((o) => ({ company: o.company, amount: o.net ?? o.uplift, basis: `best case: if it gets ${o.label}`, thin: o.thin }))
      .sort((a, b) => b.amount - a.amount);
  }, [advice]);
  // The big three always get a card, so "no BGS card" never reads as "BGS not checked".
  const missingCompanies = useMemo(() => (["PSA", "CGC", "BGS"] as Company[]).filter((c) => !companyCards.some((card) => card.company === c)), [companyCards]);

  // The decision's company: what each outcome would look like with it.
  const focusCompany = advice?.headline.company ?? companyCards[0]?.company ?? null;
  const scenarios = useMemo(
    () => (sales && focusCompany ? scenariosFor(outcomesFor(sales.buckets, costs), costs, focusCompany) : []),
    [sales, costs, focusCompany],
  );
  const keepShare = 1 - Math.min(Math.max(costs.sellFeePct, 0), 100) / 100;
  const focusGradingCost = focusCompany ? (costs.gradingCost[focusCompany] ?? 0) : 0;
  // Grades grouped by company, in the same order as the cards.
  const gradeGroups = useMemo(() => {
    if (!advice) return [];
    const order = companyCards.map((c) => c.company);
    const groups = new Map<Company, typeof advice.outcomes>();
    for (const o of advice.outcomes) groups.set(o.company, [...(groups.get(o.company) ?? []), o]);
    return [...groups.entries()]
      .map(([company, rows]) => ({ company, rows, sales: rows.reduce((n, r) => n + r.count, 0) }))
      .sort((a, b) => (order.indexOf(a.company) + 99) % 99 - (order.indexOf(b.company) + 99) % 99);
  }, [advice, companyCards]);

  // The one warning worth showing up front: skip the legend for "few" and
  // the missing-cost reminder (the rows already say "before grading fee").
  const keyWarning = advice?.warnings.find((w) => !w.startsWith("*") && !w.startsWith("No grading cost entered")) ?? null;

  const span = useMemo(() => {
    const dates = used.map((l) => l.soldDate).filter((d): d is string => Boolean(d)).sort();
    if (dates.length < 2) return null;
    const days = Math.max(1, Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000));
    return { from: dates[0], to: dates[dates.length - 1], days };
  }, [used]);

  // PSA tier from the best plain-10 sale price (what you'd declare).
  const psaTier = useMemo(() => {
    const ten = sales?.buckets.filter((b) => b.grade === 10 && b.label === `${b.company} 10`).sort((a, b) => b.median - a.median)[0];
    return ten ? suggestPsaTier(ten.median) : null;
  }, [sales]);

  // Batch ranking: by expected profit at your odds, else by profit at a plain 10.
  const ranked = useMemo(() => {
    if (!batchRows) return null;
    return batchRows.map((row) => {
      if (!row.ok) return { row, advice: null, score: Number.NEGATIVE_INFINITY, best: null as string | null, sales: 0 };
      const itemCosts: CostInputs = { ...costs, rawCost: row.rawMarketUsd ?? costs.rawCost };
      const itemAdvice = adviseOn(row.result.buckets, itemCosts);
      const expected = itemAdvice.expected.find((e) => e.coveredPct >= 50);
      const tens = itemAdvice.outcomes.filter((o) => o.grade === 10 && o.label === `${o.company} 10`).sort((a, b) => (b.net ?? b.uplift) - (a.net ?? a.uplift));
      const score = expected ? expected.expectedNet : tens[0] ? (tens[0].net ?? tens[0].uplift) : Number.NEGATIVE_INFINITY;
      const best = expected ? `${expected.company} (expected)` : tens[0] ? `${tens[0].label} (if it gets a 10)` : null;
      return { row, advice: itemAdvice, score, best, sales: row.result.listings.filter((l) => l.used).length };
    }).sort((a, b) => b.score - a.score);
  }, [batchRows, costs]);

  const chip = (active: boolean, wrap = false) =>
    `${wrap ? "max-w-full text-left" : "whitespace-nowrap"} rounded-full border px-3.5 py-1.5 text-sm transition ${active ? "border-[var(--action)] bg-[var(--action)] text-white" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--action)]"}`;
  const input = "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base outline-none focus:border-[var(--action)]";
  const button = "rounded-lg bg-[var(--action)] px-5 py-2.5 font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60";
  const quiet = "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold transition hover:border-[var(--action)] disabled:opacity-60";
  const card$ = "rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5";
  const toneColor = { good: "var(--good)", bad: "var(--bad)", thin: "var(--thin)" } as const;
  const toneSoft = { good: "var(--good-soft)", bad: "var(--bad-soft)", thin: "var(--thin-soft)" } as const;

  const activePreset = ODDS_PRESETS.find((preset) => ODDS_GRADES.every((g) => oddsText[g] === String(preset.odds[g])))?.name ?? null;
  const numbersSummary = [
    rawCost ? `raw ${money(numberOrNull(rawCost) ?? 0)}` : "raw cost not set",
    `fees ${sellFeePct || 0}%`,
    ...costCompanies.filter((c) => numberOrNull(gradingCost[c] ?? "") != null).map((c) => `${c} ${money(numberOrNull(gradingCost[c] ?? "") ?? 0)}`),
    gradeOdds && oddsAreUsable(gradeOdds) ? `odds ${ODDS_GRADES.map((g) => gradeOdds[g]).join("/")}` : "no odds",
  ].join(" · ");

  const oddsEditor = (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">What condition is your card in?</p>
        <p className="text-xs" style={{ color: gradeOdds && !oddsAreUsable(gradeOdds) ? "var(--bad)" : "var(--muted)" }}>
          {gradeOdds ? `Total ${Math.round(oddsTotal)}%${oddsAreUsable(gradeOdds) ? "" : " — needs to add up to 100%"}` : "Optional"}
        </p>
      </div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Pick the one that fits. It sets how likely each grade is, so the result can give you one expected profit instead of a profit per grade.
      </p>
      <div className="mt-2 inline-flex w-full flex-wrap rounded-lg border border-[var(--line)] p-1 sm:w-auto" role="group" aria-label="Odds presets">
        {[...ODDS_PRESETS.map((p) => p.name), "Custom"].map((name) => {
          const active = name === "Custom" ? !activePreset && Boolean(gradeOdds) : activePreset === name;
          return (
            <button key={name} type="button" aria-pressed={active}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition sm:flex-none ${active ? "bg-[var(--action)] font-semibold text-white" : "hover:bg-[var(--bg)]"}`}
              onClick={() => {
                const preset = ODDS_PRESETS.find((p) => p.name === name);
                if (preset) setOddsText(Object.fromEntries(ODDS_GRADES.map((g) => [g, String(preset.odds[g])])) as Record<OddsGrade, string>);
              }}
              title={ODDS_PRESETS.find((p) => p.name === name)?.hint ?? "Type your own percentages below"}>
              {name}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 min-h-[1.25rem] text-xs">
        {activePreset ? ODDS_PRESETS.find((p) => p.name === activePreset)?.hint : gradeOdds ? "Your own odds. Each box is the % chance of that grade." : ""}
      </p>
      <p className="mt-2 text-xs font-semibold text-[var(--muted)]">Chance of each grade (%)</p>
      <div className="mt-1 grid grid-cols-4 gap-2">
        {ODDS_GRADES.map((grade) => (
          <label key={grade} className="text-sm">
            <span className="block text-xs text-[var(--muted)]">{grade === 7 ? "7 or lower" : `Grade ${grade}`}</span>
            <input className={input} inputMode="decimal" value={oddsText[grade]} placeholder="%"
              onChange={(e) => setOddsText((prev) => ({ ...prev, [grade]: e.target.value }))} />
          </label>
        ))}
      </div>
      {gradeOdds && <button type="button" className="mt-1 text-xs text-[var(--muted)] underline" onClick={() => setOddsText(EMPTY_ODDS)}>Clear odds</button>}
    </div>
  );

  const step = (n: number, title: string, done = false) => (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold"
        style={{ background: done ? "var(--action)" : "var(--bg)", color: done ? "#fff" : "var(--fg)", border: done ? "none" : "1px solid var(--line)" }}>
        {done ? "✓" : n}
      </span>
      <h2 className="text-lg font-bold">{title}</h2>
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
          <rect x="7" y="3" width="26" height="34" rx="4" fill="var(--action)" />
          <rect x="10" y="6" width="20" height="5" rx="1.5" fill="#fff" opacity="0.9" />
          <rect x="10" y="14" width="20" height="20" rx="2" fill="#fff" opacity="0.18" />
          <path d="M14.5 24.5l4 4 7.5-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Grading Check</h1>
          <p className="text-sm text-[var(--muted)]">Real graded sold prices, and whether grading your card pays.</p>
        </div>
      </header>

      <section className={card$}>
        {step(1, "Find your card", Boolean(card))}
        {!card && <p className="-mt-1 mb-3 text-sm text-[var(--muted)]">Choose the game, then type the card name or the number printed on it (for example OP05-119 or 4/102).</p>}
        <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex gap-2">
            <button type="button" className={chip(game === "pokemon")} onClick={() => { setGame("pokemon"); setCards(null); setCard(null); setSales(null); setLanguage("english"); }}>Pokémon</button>
            <button type="button" className={chip(game === "onepiece")} onClick={() => { setGame("onepiece"); setCards(null); setCard(null); setSales(null); }}>One Piece</button>
          </div>
          <input className={input} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={game === "pokemon" ? "e.g. Charizard 4/102 or Umbreon VMAX" : "e.g. Shanks or OP01-120"} aria-label="Card name or number" />
          <button type="submit" disabled={searching} className={button}>{searching ? "Searching…" : "Search"}</button>
        </form>

        {cards && !card && (
          <div className="mt-4">
            {cards.length === 0 ? (
              <p className="text-[var(--muted)]">No cards found. Try just the name, or the card number.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-[var(--muted)]">
                  {resultTiles.length > TILE_LIMIT
                    ? `Showing ${TILE_LIMIT} of ${resultTiles.length}. Type the number printed on your card (e.g. OP05-119) to see just its versions.`
                    : `${resultTiles.length} result${resultTiles.length === 1 ? "" : "s"}. Tap the one that looks like your card.`}
                </p>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {resultTiles.slice(0, TILE_LIMIT).map(({ item, version }) => (
                    <li key={`${item.game}-${version?.key ?? item.id}`}>
                      <button type="button" onClick={() => pickCard(item, version ?? undefined)} className="h-full w-full rounded-xl border border-[var(--line)] p-2 text-left transition hover:border-[var(--action)] hover:shadow-sm">
                        {(version?.image ?? item.image) && <img src={(version?.image ?? item.image) as string} alt="" loading="lazy" className="mx-auto aspect-[63/88] w-full rounded-lg object-contain" />}
                        <span className="mt-2 block text-sm font-semibold leading-tight">{item.name}</span>
                        {version && <span className="block text-xs font-semibold leading-snug" style={{ color: "var(--action)" }}>{version.label}</span>}
                        <span className="block text-xs text-[var(--muted)]">{item.number} · {item.setName}</span>
                        {version?.rawMarketUsd != null && <span className="block text-xs tabular-nums text-[var(--muted)]">{money(version.rawMarketUsd)} ungraded</span>}
                        {!version && item.versions.length > 1 && <span className="block text-xs text-[var(--muted)]">{item.versions.length} versions</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {error && <p role="alert" className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>{error}</p>}

      {card && (
        <section className={`${card$} mt-4`}>
          {step(2, "Pick the exact version", Boolean(sales))}
          <p className="-mt-1 mb-3 text-sm text-[var(--muted)]">
            The same card number comes in versions worth very different amounts. Tap the one that matches yours and check it against the picture. The price on each is what an ungraded copy sells for.
          </p>
          <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
            <div className="flex gap-4 sm:block">
              {(selectedVersion?.image ?? card.image) && <img src={(selectedVersion?.image ?? card.image) as string} alt={`${card.name}${selectedVersion ? `, ${selectedVersion.label}` : ""}`} className="w-32 shrink-0 rounded-xl shadow-md sm:w-full" />}
              <div className="sm:mt-3">
                <p className="text-xl font-bold leading-tight sm:hidden">{card.name}</p>
                <p className="text-sm text-[var(--muted)] sm:hidden">{card.number} · {card.setName}{card.rarity ? ` · ${card.rarity}` : ""}</p>
                <button type="button" className="mt-2 text-sm underline sm:mt-0" onClick={() => { setCard(null); setSales(null); }}>← Other results</button>
              </div>
            </div>
            <div className="min-w-0">
              <p className="hidden text-2xl font-bold leading-tight sm:block">{card.name}</p>
              <p className="hidden text-[var(--muted)] sm:block">{card.number} · {card.setName}{card.rarity ? ` · ${card.rarity}` : ""}</p>

              <p className="mt-4 text-sm font-semibold">Version</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {card.versions.map((version) => (
                  <button key={version.key} type="button" className={chip(version.key === versionKey, true)} onClick={() => pickVersion(version)}>
                    {version.label}{version.rawMarketUsd != null ? <span className="opacity-75"> · {money(version.rawMarketUsd)}</span> : ""}
                  </button>
                ))}
                <button type="button" className={chip(customOpen)} onClick={() => setCustomOpen((open) => !open)}>Other version…</button>
              </div>
              {customOpen && (
                <div className="mt-2 rounded-xl border border-[var(--line)] p-3 text-sm">
                  <label className="block font-semibold">Type the version as sellers write it</label>
                  <div className="mt-1 flex gap-2">
                    <input className={input} value={customText} placeholder="e.g. Magazine Promo" maxLength={40}
                      onChange={(e) => { setCustomText(e.target.value); setSales(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyTypedVersion(); } }} />
                    <button type="button" className={quiet} disabled={!typedVersion} onClick={applyTypedVersion}>Use</button>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    For versions the card list doesn&apos;t have, like a Japanese magazine promo. Only graded sales whose title has every word you type are counted
                    {typedVersion?.key === versionKey ? `. Using: "${typedVersion.label}"` : ""}. No raw price is known for a typed version, so enter yours.
                  </p>
                </div>
              )}

              {card.game === "onepiece" && (
                <>
                  <p className="mt-4 text-sm font-semibold">Language</p>
                  <div className="mt-2 flex gap-2">
                    {(["english", "japanese"] as const).map((lang) => (
                      <button key={lang} type="button" className={chip(language === lang)} onClick={() => {
                        setLanguage(lang); setSales(null);
                        setRawCost(lang === "english" && selectedVersion?.rawMarketUsd != null ? String(selectedVersion.rawMarketUsd) : "");
                      }}>
                        {lang === "english" ? "English" : "Japanese"}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {card && (
        <section className={`${card$} mt-4`}>
          <details open={numbersOpen} onToggle={(e) => setNumbersOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                {step(3, "Your costs and odds")}
                {!numbersOpen && <p className="-mt-1 truncate pl-10 text-sm text-[var(--muted)]">{numbersSummary}</p>}
                {numbersOpen && <p className="-mt-1 mb-3 text-sm text-[var(--muted)]">All optional. Fill in what you know, then get prices. Empty grading costs are treated as $0, and you can change anything after the result appears.</p>}
              </div>
              <span className="mt-1 shrink-0 text-sm text-[var(--muted)] underline">{numbersOpen ? "Hide" : "Edit"}</span>
            </summary>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm">
                <span className="block font-semibold">Ungraded value (USD)</span>
                <input className={input} inputMode="decimal" value={rawCost} onChange={(e) => setRawCost(e.target.value)} placeholder="e.g. 25" />
                <span className="text-xs text-[var(--muted)]">
                  What you could sell it for as it is. Grading only pays if it beats this.{" "}
                  {selectedVersion?.rawMarketUsd != null && language === "english" ? `Filled in from TCGplayer (${money(selectedVersion.rawMarketUsd)}).` : "No market price known for this version, so enter your own."}
                </span>
              </label>
              <label className="text-sm">
                <span className="block font-semibold">Selling fees %</span>
                <input className={input} inputMode="decimal" value={sellFeePct} onChange={(e) => setSellFeePct(e.target.value)} />
                <span className="text-xs text-[var(--muted)]">What eBay and payments take when you sell the slab. 13% is typical.</span>
              </label>
              {costCompanies.map((company) => (
                <label key={company} className="text-sm">
                  <span className="block font-semibold">{company} grading cost</span>
                  <input className={input} inputMode="decimal" value={gradingCost[company] ?? ""} placeholder="Fee + postage, per card"
                    onChange={(e) => setGradingCost((prev) => ({ ...prev, [company]: e.target.value }))} />
                  {company === "PSA" && (() => {
                    const tier = psaTier ?? PSA_TIERS[0];
                    return (
                      <span className="text-xs text-[var(--muted)]">
                        {psaTier ? `For this card's value, PSA's ${tier.name} tier fits` : `PSA's cheapest tier (${tier.name}, cards worth up to ${money(tier.maxDeclaredUsd)})`}: {money(tier.feeUsd)} + postage ({PSA_FEES_AS_OF} list price).{" "}
                        <button type="button" className="underline" onClick={() => setGradingCost((prev) => ({ ...prev, PSA: String(tier.feeUsd) }))}>Use {money(tier.feeUsd)}</button>
                      </span>
                    );
                  })()}
                  {GRADER_PRICE_LINKS[company] && (
                    <span className="text-xs text-[var(--muted)]">
                      Check today&apos;s price on <a className="underline" href={GRADER_PRICE_LINKS[company]} target="_blank" rel="noreferrer">{company}&apos;s site</a>, then add postage.
                    </span>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 border-t border-[var(--line)] pt-4">{oddsEditor}</div>
          </details>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
            <button type="button" onClick={getPrices} disabled={pricing || !versionKey} className={button}>
              {sales ? "Refresh sold prices" : "Get graded sold prices"}
            </button>
            <button type="button" onClick={addToBatch} disabled={!versionKey || inBatch || batch.length >= BATCH_MAX} className={quiet}>
              {inBatch ? "In batch ✓" : batch.length >= BATCH_MAX ? `Batch full (${BATCH_MAX})` : "+ Add to batch"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">Searches up to 80 eBay.com sold listings from the last 90 days. Each new search uses up to {money(COST_PER_LOOKUP_USD)} of the Apify budget; repeat lookups within 12 hours are free.</p>
        </section>
      )}

      {pricing && (
        <section className={`${card$} mt-4 flex items-center gap-4`} role="status" aria-live="polite">
          <span className="h-9 w-9 shrink-0 rounded-full border-4 border-[var(--line)]" style={{ borderTopColor: "var(--action)", animation: "tcg-spin 0.9s linear infinite" }} aria-hidden="true" />
          <div>
            <p className="font-semibold">Searching eBay sold listings…</p>
            <p className="text-sm text-[var(--muted)]">
              Usually 30–60 seconds. {pricingSeconds}s so far.
              {pricingSeconds > 75 ? " Busy cards take longer; it gives up after 3 minutes." : " You can keep this tab open in the background."}
            </p>
          </div>
        </section>
      )}

      {sales && advice && !pricing && (
        <section className="mt-4 space-y-4">
          <div className="rounded-2xl border-2 p-5 sm:p-6" style={{ borderColor: toneColor[advice.headline.tone], background: toneSoft[advice.headline.tone] }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {sales.card.name} · {sales.version.label}{sales.card.game === "onepiece" ? ` · ${sales.language === "english" ? "English" : "Japanese"}` : ""}
            </p>
            <p className="mt-1 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl" style={{ color: toneColor[advice.headline.tone] }}>
              {advice.headline.action}
            </p>
            {advice.headline.amount != null && (
              <p className="mt-1 text-base">
                <span className="font-bold tabular-nums" style={{ color: advice.headline.amount > 0 ? toneColor.good : toneColor.bad }}>{signed(advice.headline.amount)}</span>{" "}
                <span className="text-[var(--muted)]">{advice.headline.label}</span>
              </p>
            )}
            {advice.headline.tone === "thin" && (
              <p className="mt-2 text-sm font-medium" style={{ color: toneColor.thin }}>Based on only a few sales, so treat it as a rough guide.</p>
            )}
          </div>

          {focusCompany && scenarios.length > 0 && (
            <div className={card$}>
              <h2 className="text-lg font-bold">Sell it raw, or grade it?</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[var(--line)] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Sell raw now</p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums">{costs.rawCost ? `~${money(costs.rawCost)}` : "?"}</p>
                  <p className="text-xs text-[var(--muted)]">{costs.rawCost ? "its ungraded value, no waiting" : "enter the ungraded value in step 3"}</p>
                </div>
                {(() => {
                  const likely = scenarios.find((x) => x.kind === "likely")!;
                  const youGet = likely.salePrice * keepShare - focusGradingCost;
                  const better = youGet - costs.rawCost;
                  return (
                    <div className="rounded-xl border-2 p-3" style={{ borderColor: better > 0 ? toneColor.good : "var(--line)" }}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Grade with {focusCompany}</p>
                      <p className="mt-1 text-2xl font-extrabold tabular-nums">~{money(Math.max(0, youGet))}</p>
                      <p className="text-xs text-[var(--muted)]">
                        if it gets a {likely.grade === 7 ? "7 or lower" : likely.grade}: sells ~{money(likely.salePrice)}, minus fees{focusGradingCost ? ` and the ${money(focusGradingCost)} grading cost` : ""}. Plus the wait for grading.
                      </p>
                      {costs.rawCost > 0 && (
                        <p className="mt-1.5 text-sm font-bold tabular-nums" style={{ color: better > 0 ? toneColor.good : toneColor.bad }}>
                          {better > 0 ? `${money(better)} more than selling raw` : `${money(Math.abs(better))} less than selling raw`}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              <h3 className="mt-5 text-sm font-semibold">What could happen with {focusCompany}</h3>
              <ul className="mt-2 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
                {scenarios.map((x) => {
                  const title = { best: "Best case", likely: "Most likely", worst: "Worst case" }[x.kind];
                  const gradeText = x.grade === 7 ? "7 or lower" : String(x.grade);
                  return (
                    <li key={x.kind} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="w-[6.5rem] shrink-0">
                        <span className="block text-sm font-semibold">{title}</span>
                        <span className="block text-xs text-[var(--muted)]">
                          {focusCompany} {gradeText}{x.oddsPct ? ` · ${x.oddsPct}% chance` : ""}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1 text-xs text-[var(--muted)]">
                        {x.source === "sales" ? `sells ~${money(x.salePrice)}` : x.source === "other company" ? `no ${focusCompany} sales; ${x.label.replace(" (stand-in)", "")} sells ~${money(x.salePrice)}` : `no sales at this grade; assumed to sell at its ungraded value`}
                        {x.thin ? " · few sales" : ""}
                      </span>
                      <span className="shrink-0 text-right text-base font-bold tabular-nums" style={{ color: x.net > 0 ? toneColor.good : toneColor.bad }}>{signed(x.net)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Profit compared with selling raw, after selling fees{focusGradingCost ? " and grading cost" : " (no grading cost entered)"}.{" "}
                {gradeOdds && oddsAreUsable(gradeOdds) ? "Chances come from the condition you picked in step 3." : "Pick your card's condition in step 3 to see chances and one expected profit."}
              </p>
              <a href="#why" className="mt-3 inline-block text-sm font-semibold underline">Compare all companies ↓</a>
            </div>
          )}

          <div id="why" className="scroll-mt-4 space-y-4">
            {(companyCards.length > 0 || missingCompanies.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-3">
                {companyCards.map((c, index) => (
                  <div key={c.company} className="relative overflow-hidden rounded-2xl border bg-[var(--surface)] p-4 pl-5"
                    style={{ borderColor: index === 0 && c.amount > 0 ? toneColor.good : "var(--line)" }}>
                    <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: COMPANY_COLORS[c.company] ?? "var(--muted)" }} aria-hidden="true" />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold tracking-wide">{c.company}</p>
                      {index === 0 && c.amount > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: toneSoft.good, color: toneColor.good }}>Best pick</span>}
                      {c.thin && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: toneSoft.thin, color: toneColor.thin }}>Few sales</span>}
                    </div>
                    <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: c.amount > 0 ? toneColor.good : toneColor.bad }}>{signed(c.amount)}</p>
                    <p className="text-xs text-[var(--muted)]">{c.basis}</p>
                  </div>
                ))}
                {missingCompanies.map((company) => (
                  <div key={company} className="relative overflow-hidden rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-4 pl-5 opacity-80">
                    <span className="absolute inset-y-0 left-0 w-1.5 opacity-40" style={{ background: COMPANY_COLORS[company] ?? "var(--muted)" }} aria-hidden="true" />
                    <p className="text-sm font-bold tracking-wide">{company}</p>
                    <p className="mt-1 text-lg font-bold text-[var(--muted)]">Not enough sales data</p>
                    <p className="text-xs text-[var(--muted)]">Checked, but no {company} sales of this version in the last 90 days.</p>
                  </div>
                ))}
              </div>
            )}

            {advice.outcomes.length > 0 && (
              <div className={card$}>
                <h2 className="text-lg font-bold">Sold prices by grade</h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">Tap a company to see what each grade sold for, and your profit after costs.</p>
                <div className="mt-3 space-y-2">
                  {gradeGroups.map((group, index) => (
                    <details key={group.company} open={index === 0} className="group rounded-xl border border-[var(--line)]">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COMPANY_COLORS[group.company] ?? "var(--muted)" }} aria-hidden="true" />
                        <span className="font-semibold">{group.company}</span>
                        <span className="text-sm text-[var(--muted)]">{group.sales} sale{group.sales === 1 ? "" : "s"} · {group.rows.length} grade{group.rows.length === 1 ? "" : "s"}</span>
                        <span className="ml-auto text-[var(--muted)] transition group-open:rotate-180" aria-hidden="true">▾</span>
                      </summary>
                      <ul className="border-t border-[var(--line)]">
                        {group.rows.map((o) => {
                          const profit = o.net ?? o.uplift;
                          return (
                            <li key={o.label} className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2.5 last:border-0">
                              <span className="w-12 shrink-0">
                                <span className="inline-block rounded-md px-2 py-0.5 text-sm font-bold"
                                  style={{ background: profit > 0 ? toneSoft.good : toneSoft.bad, color: profit > 0 ? toneColor.good : toneColor.bad }}>
                                  {o.label.replace(`${o.company} `, "")}
                                </span>
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold tabular-nums">{money(o.median)}</span>
                                <span className="block text-xs text-[var(--muted)]">
                                  {o.count} sale{o.count === 1 ? "" : "s"}{o.thin ? " · few" : ""}
                                  {o.low !== o.high ? ` · ${money(o.low)}–${money(o.high)}` : ""}
                                </span>
                              </span>
                              <span className="text-right">
                                <span className="block font-bold tabular-nums" style={{ color: profit > 0 ? toneColor.good : toneColor.bad }}>{signed(profit)}</span>
                                <span className="block text-xs text-[var(--muted)]">{o.net === null ? "before grading fee" : "profit"}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ))}
                </div>
              </div>
            )}

            {keyWarning && (
              <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: toneSoft.thin, color: "var(--fg)" }}>
                <span className="font-semibold" style={{ color: toneColor.thin }}>Good to know: </span>
                {keyWarning}
              </div>
            )}

            <details className={`${card$} group`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block font-semibold">More details</span>
                  <span className="block text-xs text-[var(--muted)]">How the numbers are worked out, comparisons and warnings</span>
                </span>
                <span className="text-[var(--muted)] transition group-open:rotate-180" aria-hidden="true">▾</span>
              </summary>
              <div className="mt-3 space-y-4 text-sm">
                <p>{advice.verdict}</p>
                {advice.expected.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">How the expected profit is worked out</h3>
                    <ul className="mt-1.5 space-y-1.5">
                      {advice.expected.map((e) => (
                        <li key={e.company}>
                          <span className="font-semibold">{e.company} {signed(e.expectedNet)}</span>
                          <span className="block text-xs text-[var(--muted)]">{e.used.map((u) => `${u.oddsPct}% × ${u.label} ${signed(u.net)}`).join(" + ")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {[["Same grade, different company", advice.sameGrade], ["Where a lower grade sells for more", advice.crossGrade], ["Lowest grade that makes money", advice.breakEven], ["Watch out", advice.warnings]]
                  .filter(([, lines]) => (lines as string[]).length)
                  .map(([title, lines]) => (
                    <div key={title as string}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{title as string}</h3>
                      <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {(lines as string[]).map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    </div>
                  ))}
                {span && (
                  <p className="text-[var(--muted)]">
                    Sales used run from {span.from} to {span.to} ({span.days} day{span.days === 1 ? "" : "s"}).
                    {span.days < 30 ? " eBay returns only the newest 80 listings, so for a card this busy the prices cover a short window, not 90 days." : ""}
                  </p>
                )}
                <p className="text-xs text-[var(--muted)]">
                  Profit = typical sold price − selling fees − ungraded value − grading cost. &ldquo;Few&rdquo; = under 3 sales, so one odd sale can swing it.
                  Sales over 3× or under ⅓ of the rest of their grade are left out (see Excluded listings).
                </p>
              </div>
            </details>
          </div>

          {([["Sales used", `${used.length} eBay sales the prices are based on`, used, false], ["Excluded listings", `${excluded.length} left out, each with the reason`, excluded, true]] as const).map(([title, hint, items, showReason]) => (
            <details key={title} className={`${card$} group`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block font-semibold">{title} <span className="font-normal text-[var(--muted)]">({items.length})</span></span>
                  <span className="block text-xs text-[var(--muted)]">{hint}</span>
                </span>
                <span className="text-[var(--muted)] transition group-open:rotate-180" aria-hidden="true">▾</span>
              </summary>
              <ListingList items={[...items]} showReason={showReason} />
            </details>
          ))}
          <p className="px-1 text-xs text-[var(--muted)]">
            eBay search: <a className="underline" target="_blank" rel="noreferrer"
              href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(sales.keyword)}&LH_Sold=1&LH_Complete=1`}>“{sales.keyword}”</a>
            {" "}· {sales.cached ? "cached result from" : "fetched"} {new Date(sales.fetchedAt).toLocaleString()}
            {" "}· {sales.historyCount} listing{sales.historyCount === 1 ? "" : "s"} on record
            {sales.budgetRemainingUsd != null ? ` · Apify budget left this month: ${money(sales.budgetRemainingUsd)}` : ""}
          </p>
        </section>
      )}

      {(batch.length > 0 || batchRows) && (
        <section className={`${card$} mt-8`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Batch <span className="font-normal text-[var(--muted)]">({batch.length}/{BATCH_MAX})</span></h2>
            <div className="flex gap-2">
              <button type="button" className={quiet} onClick={() => { setBatch([]); setBatchRows(null); }} disabled={batchRunning}>Clear</button>
              <button type="button" className={button} onClick={runBatch} disabled={batchRunning || !batch.length}>
                {batchRunning ? "Pricing all… (up to a few minutes)" : `Price all · up to ${money(batch.length * COST_PER_LOOKUP_USD)}`}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">One Apify run for every card not fetched in the last 12 hours. Ranked by expected profit at your odds, or by profit at a 10 if no odds are set. Raw cost per card is its TCGplayer price when known, else the raw cost above.</p>
          {batchError && <p role="alert" className="mt-3 rounded-xl px-4 py-3 text-sm" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>{batchError}</p>}

          {!batchRows && (
            <ul className="mt-3 space-y-1 text-sm">
              {batch.map((item) => (
                <li key={`${item.versionKey}-${item.language}`} className="flex items-center justify-between gap-2">
                  <span>{item.cardName} · {item.number} · {item.versionLabel}{item.game === "onepiece" ? ` · ${item.language === "english" ? "EN" : "JP"}` : ""}{item.rawMarketUsd != null ? ` · ${money(item.rawMarketUsd)} raw` : ""}</span>
                  <button type="button" className="text-xs underline" onClick={() => setBatch((prev) => prev.filter((b) => b !== item))}>remove</button>
                </li>
              ))}
            </ul>
          )}

          {ranked && (
            <div className="mt-3 overflow-x-auto">
              {!gradeOdds && <div className="mb-3">{oddsEditor}</div>}
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left">
                    <th className="py-2 pr-3">#</th><th className="py-2 pr-3">Card</th><th className="py-2 pr-3">Profit</th>
                    <th className="hidden py-2 pr-3 sm:table-cell">Best route</th><th className="py-2 pr-3">Sales</th><th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((entry, index) => (
                    <tr key={`${entry.row.versionKey}-${entry.row.language}`} className="border-b border-[var(--line)] align-top">
                      <td className="py-2 pr-3 text-[var(--muted)]">{index + 1}</td>
                      <td className="py-2 pr-3">
                        <span className="font-semibold">{entry.row.cardName}</span>
                        <span className="block text-xs text-[var(--muted)]">{entry.row.number} · {entry.row.versionLabel}{entry.row.game === "onepiece" ? ` · ${entry.row.language === "english" ? "EN" : "JP"}` : ""}</span>
                        {!entry.row.ok && <span className="block text-xs" style={{ color: "var(--bad)" }}>{entry.row.error}</span>}
                        {entry.advice?.warnings.length ? <span className="block text-xs text-[var(--muted)]">{entry.advice.warnings[0]}</span> : null}
                      </td>
                      <td className="py-2 pr-3 font-bold tabular-nums" style={{ color: entry.score > 0 ? "var(--good)" : "var(--bad)" }}>
                        {Number.isFinite(entry.score) ? signed(entry.score) : "—"}
                      </td>
                      <td className="hidden py-2 pr-3 sm:table-cell">{entry.best ?? <span className="text-[var(--muted)]">no graded sales found</span>}</td>
                      <td className="py-2 pr-3 tabular-nums">{entry.sales}</td>
                      <td className="py-2 pr-3">
                        {entry.row.ok && (
                          <button type="button" className="text-xs underline" onClick={() => {
                            const result = (entry.row as { result: PriceResult }).result;
                            setCard(result.card); setVersionKey(result.version.key); setLanguage(result.language);
                            setRawCost(entry.row.rawMarketUsd != null ? String(entry.row.rawMarketUsd) : ""); setSales(result); setCards(null);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}>open</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function ListingList({ items, showReason = false }: { items: ListingVerdict[]; showReason?: boolean }) {
  if (!items.length) return <p className="mt-2 text-sm text-[var(--muted)]">None.</p>;
  return (
    <ul className="mt-2 space-y-3 text-sm">
      {items.map((item, index) => (
        <li key={`${item.url}-${index}`} className="flex gap-3">
          {item.imageUrl ? (
            <a href={item.imageUrl.replace(/s-l\d+\./, "s-l1600.")} target="_blank" rel="noreferrer" className="shrink-0" aria-label="Open listing photo">
              <img src={item.imageUrl} alt="" loading="lazy" className="h-16 w-12 rounded border border-[var(--line)] object-cover" />
            </a>
          ) : (
            <span className="h-16 w-12 shrink-0 rounded border border-dashed border-[var(--line)]" aria-hidden="true" />
          )}
          <span className="min-w-0 break-words">
            <span className="font-semibold tabular-nums">{item.price != null ? money(item.price) : "—"}</span>
            {item.bestOffer ? <span className="text-xs text-[var(--muted)]"> (accepted offer)</span> : ""}
            {item.grade ? ` · ${item.grade.label}` : ""}{item.soldDate ? ` · ${item.soldDate}` : ""}{item.cert ? ` · cert ${item.cert}` : ""} ·{" "}
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.title}</a> : item.title}
            {showReason && <span className="block text-xs text-[var(--muted)]">Excluded: {item.reason}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
