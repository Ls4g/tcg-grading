"use client";
/* eslint-disable @next/next/no-img-element -- card images come from the card APIs' own CDNs */

import { useEffect, useMemo, useState } from "react";
import { adviseOn, type CostInputs } from "@/lib/tcgGrading/advice";
import type { CardResult, CardVersion } from "@/lib/tcgGrading/cards";
import type { Company, Game, GradeBucket, ListingVerdict } from "@/lib/tcgGrading/listings";

type SalesResponse = {
  card: CardResult;
  version: CardVersion;
  language: "english" | "japanese";
  keyword: string;
  fetchedAt: string;
  cached: boolean;
  budgetRemainingUsd: number | null;
  buckets: GradeBucket[];
  listings: ListingVerdict[];
};

const COST_STORAGE_KEY = "tcg-grading-costs";
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: value < 100 ? 2 : 0, maximumFractionDigits: value < 100 ? 2 : 0 })}`;

function readSavedCosts(): { sellFeePct: number; gradingCost: Partial<Record<Company, number | null>> } {
  try {
    const saved = JSON.parse(localStorage.getItem(COST_STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { sellFeePct: Number(saved.sellFeePct) || 13, gradingCost: saved.gradingCost ?? {} };
  } catch {}
  return { sellFeePct: 13, gradingCost: {} };
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function GradingTool() {
  const [game, setGame] = useState<Game>("pokemon");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [card, setCard] = useState<CardResult | null>(null);
  const [versionKey, setVersionKey] = useState("");
  const [language, setLanguage] = useState<"english" | "japanese">("english");
  const [sales, setSales] = useState<SalesResponse | null>(null);
  const [pricing, setPricing] = useState(false);
  const [error, setError] = useState("");

  const [rawCost, setRawCost] = useState("");
  const [sellFeePct, setSellFeePct] = useState("13");
  const [gradingCost, setGradingCost] = useState<Partial<Record<Company, string>>>({});

  useEffect(() => {
    const saved = readSavedCosts();
    // Restoring a per-viewer preference after mount; the server has no localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSellFeePct(String(saved.sellFeePct));
    setGradingCost(Object.fromEntries(Object.entries(saved.gradingCost).map(([k, v]) => [k, v == null ? "" : String(v)])));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COST_STORAGE_KEY, JSON.stringify({
        sellFeePct: Number(sellFeePct) || 0,
        gradingCost: Object.fromEntries(Object.entries(gradingCost).map(([k, v]) => [k, numberOrNull(v ?? "")])),
      }));
    } catch {}
  }, [sellFeePct, gradingCost]);

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
    const first = next.versions[0];
    setVersionKey(first?.key ?? "");
    setRawCost(first?.rawMarketUsd != null ? String(first.rawMarketUsd) : "");
  }

  function pickVersion(version: CardVersion) {
    setVersionKey(version.key);
    setSales(null);
    setRawCost(version.rawMarketUsd != null && language === "english" ? String(version.rawMarketUsd) : "");
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

  const costs: CostInputs = useMemo(() => ({
    rawCost: numberOrNull(rawCost) ?? 0,
    sellFeePct: numberOrNull(sellFeePct) ?? 0,
    gradingCost: Object.fromEntries(Object.entries(gradingCost).map(([k, v]) => [k, numberOrNull(v ?? "")])),
  }), [rawCost, sellFeePct, gradingCost]);

  const advice = useMemo(() => (sales ? adviseOn(sales.buckets, costs) : null), [sales, costs]);
  const companies = useMemo(() => [...new Set(sales?.buckets.map((b) => b.company) ?? [])], [sales]);
  const used = sales?.listings.filter((l) => l.used) ?? [];
  const excluded = sales?.listings.filter((l) => !l.used) ?? [];
  const selectedVersion = card?.versions.find((v) => v.key === versionKey) ?? null;

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition ${active ? "border-[var(--action)] bg-[var(--action)] text-white" : "border-[var(--line)] hover:border-[var(--action)]"}`;
  const input = "w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-base";

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
        <button type="submit" disabled={searching} className="rounded-md bg-[var(--action)] px-5 py-2 font-semibold text-white disabled:opacity-60">
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
            </div>

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

            <button type="button" onClick={getPrices} disabled={pricing || !versionKey}
              className="mt-5 rounded-md bg-[var(--action)] px-5 py-2.5 font-semibold text-white disabled:opacity-60">
              {pricing ? "Pulling eBay sold prices… (up to a minute)" : "Get graded sold prices"}
            </button>
            <p className="mt-1 text-xs text-[var(--muted)]">Searches the last 90 days of eBay.com sold listings. Each new search uses about $0.16 of the Apify budget; repeat lookups within 12 hours are free.</p>
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
              </label>
            ))}
          </div>

          {advice.outcomes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left">
                    <th className="py-2 pr-3">Grade</th><th className="py-2 pr-3">Sales</th><th className="py-2 pr-3">Median sold</th>
                    <th className="hidden py-2 pr-3 sm:table-cell">Range</th><th className="py-2 pr-3">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {advice.outcomes.map((o) => {
                    const profit = o.net ?? o.uplift;
                    return (
                      <tr key={o.label} className="border-b border-[var(--line)]">
                        <td className="py-2 pr-3 font-semibold">{o.label}</td>
                        <td className="py-2 pr-3">{o.count}{o.thin ? " *" : ""}</td>
                        <td className="py-2 pr-3 tabular-nums">{money(o.median)}</td>
                        <td className="hidden py-2 pr-3 tabular-nums text-[var(--muted)] sm:table-cell">{o.low === o.high ? "—" : `${money(o.low)}–${money(o.high)}`}</td>
                        <td className={`py-2 pr-3 font-semibold tabular-nums ${profit > 0 ? "text-[var(--action)]" : "text-red-600"}`}>
                          {profit >= 0 ? "+" : "−"}{money(Math.abs(profit))}{o.net === null ? " †" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-[var(--muted)]">Profit = median sold − fees − raw cost − grading cost. † = grading cost not entered yet.</p>
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
            eBay search: “{sales.keyword}” · {sales.cached ? "cached result from" : "fetched"} {new Date(sales.fetchedAt).toLocaleString()}
            {sales.budgetRemainingUsd != null ? ` · Apify budget left this month: ${money(sales.budgetRemainingUsd)}` : ""}
          </p>
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
          {item.grade ? ` · ${item.grade.label}` : ""}{item.soldDate ? ` · ${item.soldDate}` : ""} ·{" "}
          {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.title}</a> : item.title}
          {showReason && <span className="block text-xs text-[var(--muted)]">Excluded: {item.reason}</span>}
        </li>
      ))}
    </ul>
  );
}
