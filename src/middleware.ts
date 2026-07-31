import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isSessionTokenValid } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (await isSessionTokenValid(token)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except the login page, Next internals, and the PWA assets that
  // iOS fetches before a session exists.
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-192.png|icon-512.png).*)",
  ],
};
