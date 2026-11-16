"use client";
/* eslint-disable @next/next/no-img-element -- card images come from the card APIs' own CDNs */

import { useEffect, useMemo, useState } from "react";
import { adviseOn, ODDS_GRADES, oddsAreUsable, type CostInputs, type GradeOdds, type OddsGrade } from "@/lib/tcgGrading/advice";
import { customVersion, type CardResult, type CardVersion } from "@/lib/tcgGrading/cards";
import { PSA_FEES_AS_OF, suggestPsaTier } from "@/lib/tcgGrading/gradingFees";
import type { Company, Game, ListingVerdict } from "@/lib/tcgGrading/listings";
import type { PriceResult } from "@/lib/tcgGrading/price";

type Language = "english" | "japanese";
type BatchItem = { game: Game; versionKey: string; language: Language; cardName: string; number: string; versionLabel: string; rawMarketUsd: number | null };
type BatchRow = BatchItem & ({ ok: true; result: PriceResult } | { ok: false; error: string });

const COST_STORAGE_KEY = "tcg-grading-costs";
const ODDS_STORAGE_KEY = "tcg-grading-odds";
const BATCH_STORAGE_KEY = "tcg-grading-batch";
const BATCH_MAX = 10;
const COST_PER_LOOKUP_USD = 0.16;

const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 })}`;
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;

const ODDS_PRESETS: Array<{ name: string; odds: GradeOdds }> = [
  { name: "Pack fresh, confident", odds: { 10: 60, 9: 30, 8: 10, 7: 0 } },
  { name: "Looks clean", odds: { 10: 30, 9: 45, 8: 20, 7: 5 } },
  { name: "Played / unsure", odds: { 10: 5, 9: 30, 8: 40, 7: 25 } },
];
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

  function pickCard(next: CardResult) {
    setCard(next);
    setSales(null);
    setError("");
    setCustomOpen(false);
    setCustomText("");
    const first = next.versions[0];
    setVersionKey(first?.key ?? "");
    setRawCost(first?.rawMarketUsd != null ? String(first.rawMarketUsd) : "");
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

  async function getPrices() {
    if (!card || !versionKey) return;
    setPricing(true); setError(""); setSales(null);
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: card.game, versionKey, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Price search failed.");
      setSales(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Price search failed.");
    } finally {
      setPricing(false);
    }
  }

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
  const companies = useMemo(() => [...new Set(sales?.buckets.map((b) => b.company) ?? [])], [sales]);
  const used = sales?.listings.filter((l) => l.used) ?? [];
  const excluded = sales?.listings.filter((l) => !l.used) ?? [];

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

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition ${active ? "border-[var(--action)] bg-[var(--action)] text-white" : "border-[var(--line)] hover:border-[var(--action)]"}`;
  const input = "w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-base";
  const button = "rounded-md bg-[var(--action)] px-5 py-2 font-semibold text-white disabled:opacity-60";
  const quiet = "rounded-md border border-[var(--line)] px-4 py-2 text-sm font-semibold hover:border-[var(--action)] disabled:opacity-60";

  const oddsEditor = (
    <div className="rounded-lg border border-[var(--line)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">What grade will it get? (your odds, %)</p>
        <p className={`text-xs ${gradeOdds && !oddsAreUsable(gradeOdds) ? "text-red-600" : "text-[var(--muted)]"}`}>
          {gradeOdds ? `Total ${Math.round(oddsTotal)}%` : "Optional. Turns the table into one expected-profit number."}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {ODDS_GRADES.map((grade) => (
          <label key={grade} className="text-sm">
            <span className="block text-xs font-semibold">{grade === 7 ? "7 or lower" : `Grade ${grade}`}</span>
            <input className={input} inputMode="decimal" value={oddsText[grade]} placeholder="%"
              onChange={(e) => setOddsText((prev) => ({ ...prev, [grade]: e.target.value }))} />
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {ODDS_PRESETS.map((preset) => (
          <button key={preset.name} type="button" className={quiet}
            onClick={() => setOddsText(Object.fromEntries(ODDS_GRADES.map((g) => [g, String(preset.odds[g])])) as Record<OddsGrade, string>)}>
            {preset.name}
          </button>
        ))}
        <button type="button" className={quiet} onClick={() => setOddsText(EMPTY_ODDS)}>Clear</button>
      </div>
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold sm:text-4xl">Grading check</h1>
        <p className="mt-2 text-[var(--muted)]">
          Look up a card to see what it actually sells for at each grade and grading company, and whether grading pays.
        </p>
      </header>

      <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-2">
          <button type="button" className={chip(game === "pokemon")} onClick={() => { setGame("pokemon"); setCards(null); setCard(null); setSales(null); setLanguage("english"); }}>Pokémon</button>
          <button type="button" className={chip(game === "onepiece")} onClick={() => { setGame("onepiece"); setCards(null); setCard(null); setSales(null); }}>One Piece</button>
        </div>
        <input
          className={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={game === "pokemon" ? "e.g. Charizard 4/102 or Umbreon VMAX" : "e.g. Shanks or OP01-120"}
          aria-label="Card name or number"
        />
        <button type="submit" disabled={searching} className={button}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{error}</p>}

      {cards && !card && (
        <section className="mt-6">
          {cards.length === 0 ? (
            <p className="text-[var(--muted)]">No cards found. Try just the name, or the card number.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {cards.map((item) => (
                <li key={`${item.game}-${item.id}`}>
                  <button type="button" onClick={() => pickCard(item)} className="w-full rounded-lg border border-[var(--line)] p-2 text-left hover:border-[var(--action)]">
                    {item.image && <img src={item.image} alt="" loading="lazy" className="mx-auto aspect-[63/88] w-full rounded object-contain" />}
                    <span className="mt-2 block text-sm font-semibold leading-tight">{item.name}</span>
                    <span className="block text-xs text-[var(--muted)]">{item.number} · {item.setName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {card && (
        <section className="mt-6 grid gap-6 sm:grid-cols-[180px_1fr]">
          <div>
            {card.image && <img src={card.image} alt={card.name} className="w-full max-w-[140px] rounded sm:max-w-[180px]" />}
            <button type="button" className="mt-2 text-sm underline" onClick={() => { setCard(null); setSales(null); }}>← Back to results</button>
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">{card.name}</h2>
            <p className="text-[var(--muted)]">{card.number} · {card.setName}{card.rarity ? ` · ${card.rarity}` : ""}</p>

            <p className="mt-4 text-sm font-semibold">Which version do you have?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {card.versions.map((version) => (
                <button key={version.key} type="button" className={chip(version.key === versionKey)} onClick={() => pickVersion(version)}>
                  {version.label}{version.rawMarketUsd != null ? ` · ${money(version.rawMarketUsd)} raw` : ""}
                </button>
              ))}
              <button type="button" className={chip(customOpen)} onClick={() => setCustomOpen((open) => !open)}>Other version…</button>
            </div>
            {customOpen && (
              <div className="mt-2 rounded-lg border border-[var(--line)] p-3 text-sm">
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

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={getPrices} disabled={pricing || !versionKey} className={`${button} py-2.5`}>
                {pricing ? "Pulling eBay sold prices… (up to a minute)" : "Get graded sold prices"}
              </button>
              <button type="button" onClick={addToBatch} disabled={!versionKey || inBatch || batch.length >= BATCH_MAX} className={quiet}>
                {inBatch ? "In batch ✓" : batch.length >= BATCH_MAX ? `Batch full (${BATCH_MAX})` : "+ Add to batch"}
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">Searches the last 90 days of eBay.com sold listings. Each new search uses about {money(COST_PER_LOOKUP_USD)} of the Apify budget; repeat lookups within 12 hours are free.</p>
          </div>
        </section>
      )}

      {sales && advice && (
        <section className="mt-8 space-y-6">
          <div className="rounded-lg border-2 border-[var(--action)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Verdict · {sales.version.label}{sales.card.game === "onepiece" ? ` · ${sales.language === "english" ? "English" : "Japanese"}` : ""}</p>
            <p className="mt-1 text-lg font-semibold">{advice.verdict}</p>
          </div>

          <div className="grid gap-3 rounded-lg border border-[var(--line)] p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold">Raw card cost (USD)</span>
              <input className={input} inputMode="decimal" value={rawCost} onChange={(e) => setRawCost(e.target.value)} placeholder="What you pay" />
              <span className="text-xs text-[var(--muted)]">{selectedVersion?.rawMarketUsd != null && sales.language === "english" ? `TCGplayer market: ${money(selectedVersion.rawMarketUsd)}` : "No raw market price for this version — enter yours."}</span>
            </label>
            <label className="text-sm">
              <span className="block font-semibold">Selling fees %</span>
              <input className={input} inputMode="decimal" value={sellFeePct} onChange={(e) => setSellFeePct(e.target.value)} />
              <span className="text-xs text-[var(--muted)]">eBay + payment fees on the sale.</span>
            </label>
            {companies.map((company) => (
              <label key={company} className="text-sm">
                <span className="block font-semibold">{company} cost per card</span>
                <input className={input} inputMode="decimal" value={gradingCost[company] ?? ""} placeholder="Fee + shipping"
                  onChange={(e) => setGradingCost((prev) => ({ ...prev, [company]: e.target.value }))} />
                {company === "PSA" && psaTier && (
                  <span className="text-xs text-[var(--muted)]">
                    PSA {psaTier.name} tier fits (declared value up to {money(psaTier.maxDeclaredUsd)}): {money(psaTier.feeUsd)} + shipping, {PSA_FEES_AS_OF} US list.{" "}
                    <button type="button" className="underline" onClick={() => setGradingCost((prev) => ({ ...prev, PSA: String(psaTier.feeUsd) }))}>Use it</button>
                  </span>
                )}
              </label>
            ))}
          </div>

          {oddsEditor}

          {advice.expected.length > 0 && (
            <div>
              <h3 className="font-semibold">Expected profit per card, at your odds</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {advice.expected.map((e) => (
                  <li key={e.company}>
                    <span className={`font-semibold tabular-nums ${e.expectedNet > 0 ? "text-[var(--action)]" : "text-red-600"}`}>{signed(e.expectedNet)}</span>
                    {" "}with {e.company}
                    {e.coveredPct < 100 ? <span className="text-[var(--muted)]"> · covers {e.coveredPct}% of your odds (no sales at {e.missingGrades.map((g) => (g === 7 ? "≤7" : g)).join(", ")})</span> : ""}
                    <span className="block text-xs text-[var(--muted)]">{e.used.map((u) => `${u.oddsPct}% × ${u.label} ${signed(u.net)}`).join(" + ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {advice.outcomes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left">
                    <th className="py-2 pr-3">Grade</th><th className="py-2 pr-3">Sales</th><th className="py-2 pr-3">Median sold</th>
                    <th className="py-2 pr-3">Last 30d</th>
                    <th className="hidden py-2 pr-3 sm:table-cell">Range</th><th className="py-2 pr-3">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {advice.outcomes.map((o) => {
                    const profit = o.net ?? o.uplift;
                    const move = o.recentMedian != null && o.median > 0 ? Math.round((o.recentMedian / o.median - 1) * 100) : null;
                    return (
                      <tr key={o.label} className="border-b border-[var(--line)]">
                        <td className="py-2 pr-3 font-semibold">{o.label}</td>
                        <td className="py-2 pr-3">{o.count}{o.thin ? " *" : ""}</td>
                        <td className="py-2 pr-3 tabular-nums">{money(o.median)}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {o.recentMedian == null ? <span className="text-[var(--muted)]">none</span> : (
                            <>
                              {money(o.recentMedian)}
                              <span className={`text-xs ${move != null && Math.abs(move) >= 10 ? (move > 0 ? "text-[var(--action)]" : "text-red-600") : "text-[var(--muted)]"}`}>
                                {" "}({o.recentCount} sale{o.recentCount === 1 ? "" : "s"}{move != null && move !== 0 ? `, ${move > 0 ? "+" : ""}${move}%` : ""})
                              </span>
                            </>
                          )}
                        </td>
                        <td className="hidden py-2 pr-3 tabular-nums text-[var(--muted)] sm:table-cell">{o.low === o.high ? "—" : `${money(o.low)}–${money(o.high)}`}</td>
                        <td className={`py-2 pr-3 font-semibold tabular-nums ${profit > 0 ? "text-[var(--action)]" : "text-red-600"}`}>
                          {signed(profit)}{o.net === null ? " †" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-[var(--muted)]">Profit = median sold − fees − raw cost − grading cost. † = grading cost not entered yet. Last 30d = median of sales in the last 30 days, and how far it sits from the 90-day median.</p>
            </div>
          )}

          {[["Same grade, different company", advice.sameGrade], ["Where a lower grade sells for more", advice.crossGrade], ["Lowest grade that makes money", advice.breakEven], ["Watch out", advice.warnings]]
            .filter(([, lines]) => (lines as string[]).length)
            .map(([title, lines]) => (
              <div key={title as string}>
                <h3 className="font-semibold">{title as string}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {(lines as string[]).map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            ))}

          <details className="rounded-lg border border-[var(--line)] p-3">
            <summary className="cursor-pointer font-semibold">Sales used ({used.length})</summary>
            <ListingList items={used} />
          </details>
          <details className="rounded-lg border border-[var(--line)] p-3">
            <summary className="cursor-pointer font-semibold">Excluded listings ({excluded.length}) — with reasons</summary>
            <ListingList items={excluded} showReason />
          </details>
          <p className="text-xs text-[var(--muted)]">
            eBay search: <a className="underline" target="_blank" rel="noreferrer"
              href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(sales.keyword)}&LH_Sold=1&LH_Complete=1`}>“{sales.keyword}”</a>
            {" "}· {sales.cached ? "cached result from" : "fetched"} {new Date(sales.fetchedAt).toLocaleString()}
            {" "}· {sales.historyCount} listing{sales.historyCount === 1 ? "" : "s"} on record for this search
            {sales.budgetRemainingUsd != null ? ` · Apify budget left this month: ${money(sales.budgetRemainingUsd)}` : ""}
          </p>
        </section>
      )}

      {(batch.length > 0 || batchRows) && (
        <section className="mt-10 rounded-lg border border-[var(--line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold">Batch ({batch.length}/{BATCH_MAX})</h2>
            <div className="flex gap-2">
              <button type="button" className={quiet} onClick={() => { setBatch([]); setBatchRows(null); }} disabled={batchRunning}>Clear</button>
              <button type="button" className={button} onClick={runBatch} disabled={batchRunning || !batch.length}>
                {batchRunning ? "Pricing all… (up to a few minutes)" : `Price all · up to ${money(batch.length * COST_PER_LOOKUP_USD)}`}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">One Apify run for every card not fetched in the last 12 hours. Ranked by expected profit at your odds, or by profit at a 10 if no odds are set. Raw cost per card is its TCGplayer price when known, else the raw cost above.</p>
          {batchError && <p role="alert" className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{batchError}</p>}

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
                        {!entry.row.ok && <span className="block text-xs text-red-600">{entry.row.error}</span>}
                        {entry.advice?.warnings.length ? <span className="block text-xs text-[var(--muted)]">{entry.advice.warnings[0]}</span> : null}
                      </td>
                      <td className={`py-2 pr-3 font-semibold tabular-nums ${entry.score > 0 ? "text-[var(--action)]" : "text-red-600"}`}>
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
    <ul className="mt-2 space-y-2 text-sm">
      {items.map((item, index) => (
        <li key={`${item.url}-${index}`} className="break-words">
          <span className="font-semibold tabular-nums">{item.price != null ? money(item.price) : "—"}</span>
          {item.grade ? ` · ${item.grade.label}` : ""}{item.soldDate ? ` · ${item.soldDate}` : ""}{item.cert ? ` · cert ${item.cert}` : ""} ·{" "}
          {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.title}</a> : item.title}
          {showReason && <span className="block text-xs text-[var(--muted)]">Excluded: {item.reason}</span>}
        </li>
      ))}
    </ul>
  );
}
