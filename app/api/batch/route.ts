import { isAuthorized } from "@/lib/auth";
import { parsePriceRequest, priceResult, resolveRequest, type PriceResult } from "@/lib/tcgGrading/price";
import { BATCH_MAX_KEYWORDS, searchGradedSalesBatch } from "@/lib/tcgGrading/soldSearch";

// One Apify run covers every card that isn't cached; up to 5 minutes.
export const maxDuration = 300;

export type BatchItemResult = { ok: true; result: PriceResult } | { ok: false; error: string };

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Sign-in is required." }, { status: 401 });
  let payload: { items?: unknown };
  try {
    payload = (await request.json()) as { items?: unknown };
  } catch {
    return Response.json({ error: "Send the cards to price." }, { status: 400 });
  }
  const raw = Array.isArray(payload.items) ? payload.items : [];
  const items = raw.map(parsePriceRequest);
  if (!items.length || items.some((item) => !item)) return Response.json({ error: "Every batch item needs a game and a version." }, { status: 400 });
  if (items.length > BATCH_MAX_KEYWORDS) return Response.json({ error: `At most ${BATCH_MAX_KEYWORDS} cards per batch.` }, { status: 400 });

  const token = process.env.APIFY_TOKEN;
  if (!token) return Response.json({ error: "APIFY_TOKEN is not configured, so sold prices can't be fetched." }, { status: 503 });

  try {
    const found = await Promise.all(items.map((item) => resolveRequest(item!)));
    const keywords = found.filter((f): f is NonNullable<typeof f> => f !== null).map((f) => f.keyword);
    const searches = await searchGradedSalesBatch(token, keywords);
    const byKeyword = new Map(keywords.map((keyword, index) => [keyword, searches[index]]));
    const results: BatchItemResult[] = found.map((f, index) => {
      if (!f) return { ok: false, error: "That card version could not be found at its source." };
      const search = byKeyword.get(f.keyword);
      if (!search) return { ok: false, error: "No search result." };
      return { ok: true, result: priceResult(f.resolved, items[index]!.language, f.keyword, search) };
    });
    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The batch search failed." }, { status: 502 });
  }
}
