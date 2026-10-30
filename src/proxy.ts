import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Runs before every matched request. Cookie-only work: refresh the Supabase
 * session and route people to the right area. No database reads here; every
 * page, action and route handler re-checks access through the data access layer.
 */

/** Signed-out people may open these. */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth", "/setup", "/verify", "/c", "/legal"];
/** Machine endpoints authenticate themselves (bearer secrets, signatures). */
const MACHINE_PATHS = ["/api/jobs", "/api/webhooks", "/api/health", "/api/public"];
/** Signed-in but not-yet-ready people (invited, MFA pending, resetting) need these. */
const ACCOUNT_PATHS = ["/mfa", "/accept-invite", "/reset-password", "/auth"];

const startsWithAny = (path: string, list: string[]) =>
  list.some((p) => path === p || path.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (startsWithAny(pathname, MACHINE_PATHS)) return NextResponse.next({ request });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    if (pathname === "/setup") return NextResponse.next({ request });
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const isPublic = startsWithAny(pathname, PUBLIC_PATHS);

  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    });

    // Verifies the JWT (locally with asymmetric keys) and refreshes an expiring session.
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;

    const redirectTo = (path: string) => {
      const redirect = NextResponse.redirect(new URL(path, request.url));
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    };

    if (!claims) {
      if (isPublic) return response;
      const login = new URL("/login", request.url);
      if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(login);
    }

    const kind = (claims.app_metadata as { kind?: string } | undefined)?.kind;
    const home = kind === "client" ? "/portal" : "/app";

    if (pathname === "/" || pathname === "/login") return redirectTo(home);
    if (startsWithAny(pathname, ACCOUNT_PATHS)) return response;
    if (kind === "client" && startsWithAny(pathname, ["/app"])) return redirectTo("/portal");
    if (kind === "staff" && startsWithAny(pathname, ["/portal"])) return redirectTo("/app");
    return response;
  } catch {
    // Fail closed for private areas, open for public pages.
    if (isPublic) return response;
    return NextResponse.redirect(new URL("/login?error=session", request.url));
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|txt)$).*)",
  ],
};
