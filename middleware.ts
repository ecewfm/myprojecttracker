import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Cron routes carry their own bearer secret; login must stay reachable.
  if (pathname.startsWith("/api/cron")) return NextResponse.next();
  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname === "/login") return NextResponse.next();

  // Public share links authenticate with their own token, not the session.
  // /p/<token> is the page; /api/public/* is what that page calls.
  if (pathname.startsWith("/p/")) return NextResponse.next();
  if (pathname.startsWith("/api/public/")) return NextResponse.next();

  const ok = await isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!ok) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
