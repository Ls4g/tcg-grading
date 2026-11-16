import { isAuthorized } from "@/lib/auth";
import { parsePriceRequest, priceResult, resolveRequest } from "@/lib/tcgGrading/price";
import { searchGradedSales } from "@/lib/tcgGrading/soldSearch";

// A synchronous Apify run takes 20–90 seconds.
export const maxDuration = 180;

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Sign-in is required." }, { status: 401 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a card version to price." }, { status: 400 });
  }
  const item = parsePriceRequest(payload);
  if (!item) return Response.json({ error: "Choose a card and version first." }, { status: 400 });

  const token = process.env.APIFY_TOKEN;
  if (!token) return Response.json({ error: "APIFY_TOKEN is not configured, so sold prices can't be fetched." }, { status: 503 });

  try {
    const found = await resolveRequest(item);
    if (!found) return Response.json({ error: "That card version could not be found at its source." }, { status: 404 });
    const search = await searchGradedSales(token, found.keyword);
    return Response.json(priceResult(found.resolved, item.language, found.keyword, search));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The sold-price search failed." }, { status: 502 });
  }
}
