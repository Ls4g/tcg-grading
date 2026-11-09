import { isAuthorized } from "@/lib/auth";
import { resolveVersion, soldSearchKeyword, targetFor } from "@/lib/tcgGrading/cards";
import { bucketByGrade, judgeListing } from "@/lib/tcgGrading/listings";
import { searchGradedSales } from "@/lib/tcgGrading/soldSearch";

// A synchronous Apify run takes 20–90 seconds.
export const maxDuration = 180;

type Payload = { game?: unknown; versionKey?: unknown; language?: unknown };

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Sign-in is required." }, { status: 401 });
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return Response.json({ error: "Send a card version to price." }, { status: 400 });
  }
  const game = payload.game;
  const versionKey = typeof payload.versionKey === "string" ? payload.versionKey.slice(0, 120) : "";
  const language = payload.language === "japanese" && game === "onepiece" ? "japanese" : "english";
  if ((game !== "pokemon" && game !== "onepiece") || !versionKey) {
    return Response.json({ error: "Choose a card and version first." }, { status: 400 });
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) return Response.json({ error: "APIFY_TOKEN is not configured, so sold prices can't be fetched." }, { status: 503 });

  try {
    const resolved = await resolveVersion(game, versionKey);
    if (!resolved) return Response.json({ error: "That card version could not be found at its source." }, { status: 404 });
    const keyword = soldSearchKeyword(resolved);
    const search = await searchGradedSales(token, keyword);
    const target = targetFor(resolved, language);
    const listings = search.rows.map((row) => judgeListing(target, row));
    return Response.json({
      card: resolved.card,
      version: resolved.version,
      language,
      keyword,
      fetchedAt: search.fetchedAt,
      cached: search.cached,
      budgetRemainingUsd: search.budget?.remainingUsd ?? null,
      buckets: bucketByGrade(listings),
      listings,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The sold-price search failed." }, { status: 502 });
  }
}
