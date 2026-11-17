// Turning graded sold prices into the comparisons a person grading a card
// actually needs: which grader pays most at the grade they expect, where a
// lower grade from one company outsells a higher grade from another, and the
// lowest grade at which grading pays for itself.
//
// Pure: runs in the browser so the numbers update as costs are typed.

import type { Company, GradeBucket } from "./listings.ts";

export const THIN_DATA = 3;

/** Grades the user can put odds on. 7 stands for "7 or lower". */
export const ODDS_GRADES = [10, 9, 8, 7] as const;
export type OddsGrade = (typeof ODDS_GRADES)[number];
export type GradeOdds = Record<OddsGrade, number>;

export type CostInputs = {
  /** What the raw card costs you (or what you could sell it for raw instead). */
  rawCost: number;
  /** Marketplace + payment fees on the sale, as a percentage. */
  sellFeePct: number;
  /** Per-card grading cost including shipping/insurance, per company. Null = not entered. */
  gradingCost: Partial<Record<Company, number | null>>;
  /** Your odds, in percent, of each grade. Optional; must sum to 100 to be used. */
  gradeOdds?: GradeOdds | null;
};

export type ExpectedSource = "sales" | "other company" | "raw value";

export type ExpectedOutcome = {
  company: Company;
  /** Odds-weighted profit per card. Every grade with odds is filled in. */
  expectedNet: number;
  /** Share of the odds (0-100) backed by this company's own sales. */
  coveredPct: number;
  /** Grades with no sales at this company (filled from elsewhere). */
  missingGrades: OddsGrade[];
  /** Share of the odds (0-100) resting on grades with fewer than THIN_DATA sales. */
  thinPct: number;
  /** What stood in for each odds grade. */
  used: Array<{ grade: OddsGrade; label: string; net: number; oddsPct: number; source: ExpectedSource; thin: boolean }>;
};

export type BucketOutcome = GradeBucket & {
  thin: boolean;
  /** Sale price minus fees minus raw cost, before grading cost. */
  uplift: number;
  /** Uplift minus grading cost; null until that company's cost is entered. */
  net: number | null;
};

/** The one number the result leads with, and how much to trust it. */
export type Headline = {
  tone: "good" | "bad" | "thin";
  /** Profit per card in USD; null when there is nothing to base it on. */
  amount: number | null;
  /** What the amount is, e.g. "expected per card with PSA". */
  label: string;
};

export type Advice = {
  outcomes: BucketOutcome[];
  /** Per company, when odds were entered and sum to 100. */
  expected: ExpectedOutcome[];
  headline: Headline;
  verdict: string;
  sameGrade: string[];
  crossGrade: string[];
  breakEven: string[];
  warnings: string[];
};

const money = (value: number) => {
  const digits = Math.abs(value) < 100 ? 2 : 0;
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

export function outcomesFor(buckets: GradeBucket[], costs: CostInputs): BucketOutcome[] {
  const keep = 1 - Math.min(Math.max(costs.sellFeePct, 0), 100) / 100;
  return buckets.map((bucket) => {
    const uplift = Math.round((bucket.median * keep - costs.rawCost) * 100) / 100;
    const cost = costs.gradingCost[bucket.company];
    return {
      ...bucket,
      thin: bucket.count < THIN_DATA,
      uplift,
      net: typeof cost === "number" && Number.isFinite(cost) ? Math.round((uplift - cost) * 100) / 100 : null,
    };
  });
}

export function oddsAreUsable(odds: GradeOdds | null | undefined): odds is GradeOdds {
  if (!odds) return false;
  const values = ODDS_GRADES.map((grade) => odds[grade]);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return false;
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) < 0.01;
}

/** The plain bucket that stands for an odds grade at one company, if any. */
function bucketForOdds(outcomes: BucketOutcome[], company: Company, grade: OddsGrade): BucketOutcome | null {
  const plain = outcomes.filter((o) => o.company === company && o.label === `${o.company} ${o.grade}`);
  if (grade === 7) {
    // "7 or lower": the highest grade at or below 7 with data.
    return plain.filter((o) => o.grade <= 7).sort((a, b) => b.grade - a.grade)[0] ?? null;
  }
  // A 9.5 counts for a 9 when there is no plain 9 (BGS/CGC half grades).
  return plain.find((o) => o.grade === grade) ?? plain.find((o) => o.grade === grade + 0.5) ?? null;
}

/** Same grade at other companies: the median of their plain-grade medians. */
function crossCompanyProxy(outcomes: BucketOutcome[], company: Company, grade: OddsGrade): BucketOutcome | null {
  const others = [...new Set(outcomes.map((o) => o.company))]
    .filter((other) => other !== company)
    .map((other) => bucketForOdds(outcomes, other, grade))
    .filter((o): o is BucketOutcome => o !== null)
    .sort((a, b) => a.median - b.median);
  return others.length ? others[Math.floor((others.length - 1) / 2)] : null;
}

/**
 * Expected profit per company. A grade with no sales at that company is NOT
 * dropped (that hides the bad outcomes and flatters the result). It is filled
 * from the same grade at another company, or failing that, by assuming the
 * slab sells for the raw price: you lose the fees and the grading cost.
 */
export function expectedFor(outcomes: BucketOutcome[], costs: CostInputs): ExpectedOutcome[] {
  if (!oddsAreUsable(costs.gradeOdds)) return [];
  const odds = costs.gradeOdds;
  const keep = 1 - Math.min(Math.max(costs.sellFeePct, 0), 100) / 100;
  const companies = [...new Set(outcomes.map((o) => o.company))];
  return companies
    .map((company): ExpectedOutcome => {
      const cost = costs.gradingCost[company];
      const gradingCost = typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
      const used: ExpectedOutcome["used"] = [];
      const missingGrades: OddsGrade[] = [];
      let expectedNet = 0;
      let coveredPct = 0;
      let thinPct = 0;
      for (const grade of ODDS_GRADES) {
        const oddsPct = odds[grade];
        if (oddsPct <= 0) continue;
        const own = bucketForOdds(outcomes, company, grade);
        let entry: ExpectedOutcome["used"][number];
        if (own) {
          entry = { grade, label: own.label, net: own.uplift - gradingCost, oddsPct, source: "sales", thin: own.thin };
          coveredPct += oddsPct;
        } else {
          missingGrades.push(grade);
          const proxy = crossCompanyProxy(outcomes, company, grade);
          entry = proxy
            ? { grade, label: `${proxy.label} (stand-in)`, net: proxy.uplift - gradingCost, oddsPct, source: "other company", thin: proxy.thin }
            : { grade, label: `${grade === 7 ? "≤7" : grade} at raw value`, net: Math.round((costs.rawCost * keep - costs.rawCost - gradingCost) * 100) / 100, oddsPct, source: "raw value", thin: false };
        }
        if (entry.thin) thinPct += oddsPct;
        used.push(entry);
        expectedNet += (entry.net * oddsPct) / 100;
      }
      return { company, expectedNet: Math.round(expectedNet * 100) / 100, coveredPct: Math.round(coveredPct), missingGrades, thinPct: Math.round(thinPct), used };
    })
    .sort((a, b) => b.expectedNet - a.expectedNet);
}

export function adviseOn(buckets: GradeBucket[], costs: CostInputs): Advice {
  const outcomes = outcomesFor(buckets, costs);
  const expected = expectedFor(outcomes, costs);
  const warnings: string[] = [];

  if (!outcomes.length) {
    return {
      outcomes,
      expected,
      headline: { tone: "thin", amount: null, label: "No graded sales found" },
      verdict: "No graded sales of this exact card version were found in the last 90 days, so there is nothing to base a grading decision on.",
      sameGrade: [], crossGrade: [], breakEven: [],
      warnings: ["Check the excluded listings below — the card may sell under a different version or language."],
    };
  }

  // 1. Same grade, different company.
  const sameGrade: string[] = [];
  const grades = [...new Set(outcomes.map((o) => o.grade))].sort((a, b) => b - a);
  for (const grade of grades) {
    // Plain grades only: CGC Pristine / BGS Black Label are their own tier.
    const plain = outcomes
      .filter((o) => o.grade === grade && o.label === `${o.company} ${o.grade}`)
      .sort((a, b) => b.median - a.median);
    if (plain.length < 2) continue;
    const [best, next] = plain;
    const ratio = next.median > 0 ? best.median / next.median : 0;
    const gap = ratio >= 1.15 ? ` — about ${ratio >= 2 ? `${ratio.toFixed(1)}×` : `${Math.round((ratio - 1) * 100)}%`} more than ${next.company}` : " — roughly the same";
    sameGrade.push(
      `Grade ${grade}: ${plain.map((o) => `${o.company} ${money(o.median)}${o.thin ? "*" : ""}`).join(" · ")}. ${best.company} pays most${gap}.`,
    );
  }

  // 2. A lower grade from one company outselling a higher grade from another.
  const crossGrade: string[] = [];
  const pairs: Array<{ low: BucketOutcome; high: BucketOutcome; ratio: number }> = [];
  for (const low of outcomes) {
    for (const high of outcomes) {
      if (low.company === high.company || low.grade >= high.grade) continue;
      if (low.median > high.median * 1.1) pairs.push({ low, high, ratio: low.median / high.median });
    }
  }
  pairs.sort((a, b) => b.ratio - a.ratio);
  const seen = new Set<string>();
  for (const { low, high } of pairs) {
    if (seen.has(low.label)) continue;
    seen.add(low.label);
    crossGrade.push(`${low.label} (${money(low.median)}${low.thin ? "*" : ""}) sells for more than ${high.label} (${money(high.median)}${high.thin ? "*" : ""}).`);
    if (crossGrade.length >= 4) break;
  }

  // 3. Lowest grade per company where grading still makes money.
  const breakEven: string[] = [];
  const companies = [...new Set(outcomes.map((o) => o.company))];
  const missingCosts = companies.filter((company) => costs.gradingCost[company] == null);
  for (const company of companies) {
    const rows = outcomes.filter((o) => o.company === company).sort((a, b) => a.grade - b.grade);
    const value = (o: BucketOutcome) => o.net ?? o.uplift;
    const lowestProfitable = rows.find((o) => value(o) > 0);
    const costNote = costs.gradingCost[company] == null ? " (before grading cost — enter it above)" : "";
    if (!lowestProfitable) {
      breakEven.push(`${company}: no grade with recorded sales makes money${costNote}.`);
    } else {
      breakEven.push(`${company}: profitable from ${lowestProfitable.label} up (${money(value(lowestProfitable))} at that grade)${costNote}.`);
    }
  }

  // Verdict.
  const value = (o: BucketOutcome) => o.net ?? o.uplift;
  const profitable = outcomes.filter((o) => value(o) > 0);
  const solid = outcomes.filter((o) => !o.thin);
  let verdict: string;
  let headline: Headline;
  // Trust order: a company whose result rests mostly on its own, solid sales.
  const solidExpected = expected.filter((e) => e.coveredPct >= 50 && e.thinPct < 30);
  const bestExpected = solidExpected[0] ?? expected.filter((e) => e.coveredPct >= 50)[0] ?? expected[0];
  if (bestExpected) {
    const others = expected.filter((e) => e !== bestExpected).map((e) => `${e.company} ${money(e.expectedNet)}`);
    headline = {
      tone: !solidExpected.includes(bestExpected) ? "thin" : bestExpected.expectedNet > 0 ? "good" : "bad",
      amount: bestExpected.expectedNet,
      label: `expected per card with ${bestExpected.company}, at your odds`,
    };
    verdict = bestExpected.expectedNet > 0
      ? `Worth grading at your odds: expected profit ${money(bestExpected.expectedNet)} per card with ${bestExpected.company}${others.length ? ` (${others.join(", ")})` : ""}.`
      : `Not worth grading at your odds: expected ${money(bestExpected.expectedNet)} per card with ${bestExpected.company}${others.length ? ` (${others.join(", ")})` : ""}.`;
    if (!solidExpected.includes(bestExpected)) {
      warnings.push(`The expected profit for ${bestExpected.company} rests largely on grades with fewer than ${THIN_DATA} sales or on stand-ins, so treat it as a rough guide.`);
    }
    const flashier = expected.find((e) => e !== bestExpected && e.expectedNet > bestExpected.expectedNet);
    if (flashier) {
      warnings.push(`${flashier.company} shows a higher expected profit (${money(flashier.expectedNet)}) but ${flashier.thinPct}% of your odds rest on grades with fewer than ${THIN_DATA} ${flashier.company} sales${flashier.coveredPct < 100 ? `, and ${100 - flashier.coveredPct}% on stand-ins` : ""}.`);
    }
    if (bestExpected.coveredPct < 100) {
      const filled = bestExpected.used.filter((u) => u.source !== "sales").map((u) => `${u.grade === 7 ? "7 or lower" : u.grade} → ${u.source === "raw value" ? "sells at raw price" : u.label}`);
      warnings.push(`No ${bestExpected.company} sales at some grades you gave odds to; filled in: ${filled.join("; ")}.`);
    }
  } else if (!profitable.length) {
    const bestLoss = [...outcomes].sort((a, b) => value(b) - value(a))[0];
    headline = { tone: "bad", amount: value(bestLoss), label: `best case: ${bestLoss.label}` };
    verdict = `Not worth grading on current sales: no grade, at any company, beats ${money(costs.rawCost)} raw after fees${missingCosts.length === companies.length ? "" : " and grading costs"}.`;
  } else {
    const best = [...profitable].sort((a, b) => value(b) - value(a))[0];
    headline = { tone: best.thin ? "thin" : "good", amount: value(best), label: `if it gets ${best.label}` };
    const minGrade = Math.min(...profitable.map((o) => o.grade));
    const belowTen = outcomes.filter((o) => o.grade < 10);
    if (profitable.every((o) => o.grade === 10) && belowTen.length) {
      verdict = `Only worth grading if you're confident of a 10 — lower grades lose money. Best result: ${best.label} at ${money(best.median)} (${money(value(best))} profit).`;
    } else if (!belowTen.length) {
      verdict = `Profitable at a 10: ${best.label} at ${money(best.median)} (${money(value(best))} profit). No sales below a 10 were found, so the downside if it grades lower is unknown.`;
    } else {
      verdict = `Worth grading if it gets ${minGrade} or better. Best result: ${best.label} at ${money(best.median)} (${money(value(best))} profit).`;
    }
  }

  if (!solid.length) warnings.push(`Every grade here has fewer than ${THIN_DATA} sales — treat all of it as a rough guide.`);
  else if (outcomes.some((o) => o.thin)) warnings.push(`* (and FEW in the table) = fewer than ${THIN_DATA} sales at that grade; one odd sale can swing it.`);
  if (missingCosts.length) warnings.push(`No grading cost entered for ${missingCosts.join(", ")} — profit shown for them is before grading cost.`);

  if (costs.gradeOdds && !oddsAreUsable(costs.gradeOdds)) warnings.push("Your grade odds don't add up to 100%, so expected profit isn't shown.");

  return { outcomes, expected, headline, verdict, sameGrade, crossGrade, breakEven, warnings };
}
