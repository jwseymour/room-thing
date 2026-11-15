import { NextResponse, type NextRequest } from "next/server";
import { isValidSessionToken, SESSION_COOKIE } from "./lib/session-token";

export function proxy(request: NextRequest) {
  if (isValidSessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // /api/capture checks its own token, because iOS Shortcuts can't hold a session.
  // /api/upload and /api/scan check the session themselves and stay out of the
  // proxy, because the proxy silently cuts request bodies off at 10 MB.
  // Full-size photos are often larger, and scans always are.
  matcher: [
    "/((?!login|api/capture|api/upload|api/scan|_next/static|_next/image|favicon.ico).*)",
  ],
};
