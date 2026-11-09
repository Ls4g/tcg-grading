import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthorized, isConfigured } from "@/lib/auth";

// Gate every page and API route behind one shared login (browser sign-in prompt).
export default function proxy(request: NextRequest) {
  if (!isConfigured()) {
    return new NextResponse("Sign-in is not configured: set APP_USERNAME and APP_PASSWORD.", { status: 503 });
  }
  if (isAuthorized(request)) return NextResponse.next();
  return new NextResponse("Sign-in required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TCG Grading", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
