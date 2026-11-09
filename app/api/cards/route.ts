import type { NextRequest } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { searchCards } from "@/lib/tcgGrading/cards";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return Response.json({ error: "Sign-in is required." }, { status: 401 });
  const game = request.nextUrl.searchParams.get("game");
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (game !== "pokemon" && game !== "onepiece") return Response.json({ error: "Choose Pokémon or One Piece." }, { status: 400 });
  if (q.length < 2) return Response.json({ error: "Type at least two characters." }, { status: 400 });
  try {
    return Response.json({ cards: await searchCards(game, q) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Card lookup failed." }, { status: 502 });
  }
}
