# Speed on the live site

`0051_faster_queue_depth.sql`, with app changes.

On the live site a dashboard left alone sent 29 background requests in six seconds, because Next.js loads every visible link in advance. Nearly every database query took under 20 ms, so the cost was the number of requests, not slow data.

## What changed

- **Links:** every link now goes through `src/components/link.tsx`, which loads a page in advance only on hover or touch. A lint rule stops `next/link` being imported directly. A thin bar at the top of the window shows a click has registered.
- **Queue count:** `queue_depth` read every job ever run. It now reads only open ones.
- **Sign-out:** a plain form post to `/auth/sign-out` replaced the server action, which could fail silently in a tab opened before a redeploy. If the auth service can't be reached, the session cookies are still cleared.

## Keep in mind

Netlify's functions run in Tokyo, beside the database. If they go back to Ohio, every database call crosses the Pacific.

## Redirects on Netlify

A route handler's `request.url` can carry the deploy's own address, not the site's. A redirect built from it left the site, and the session cookie set on the site didn't follow. Sign-out, invite and reset links, and candidate links now send a relative address through `redirectTo` in `src/lib/server/redirect.ts`. Use it for any new redirect in a route handler.
