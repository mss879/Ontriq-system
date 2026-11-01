import { NextResponse } from "next/server";

/**
 * A redirect that stays on the address the visitor is using. On Netlify a route
 * handler's request.url can carry the deploy's own address, and a session cookie
 * set for the site doesn't reach that one, so the person lands signed out.
 */
export function redirectTo(path: string, status = 303, headers?: HeadersInit) {
  const response = new NextResponse(null, { status, headers });
  response.headers.set("Location", path);
  return response;
}
