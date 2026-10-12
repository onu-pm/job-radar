// Password gate for the whole site + noindex on every response.
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "./lib/auth";

export async function proxy(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const isLogin = req.nextUrl.pathname === "/login";
  const ok = !!password && req.cookies.get(AUTH_COOKIE)?.value === (await authToken(password));

  let res: NextResponse;
  if (ok || isLogin) {
    res = NextResponse.next();
  } else if (req.nextUrl.pathname.startsWith("/api/")) {
    res = NextResponse.json({ error: "unauthorized" }, { status: 401 });
  } else {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    res = NextResponse.redirect(url);
  }
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
