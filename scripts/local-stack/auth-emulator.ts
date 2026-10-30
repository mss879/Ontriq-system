/**
 * A small, local stand-in for Supabase Auth (GoTrue) plus a gateway that
 * forwards /rest/v1 to PostgREST. Implements only what Ontriq uses: password
 * sign-in, refresh, sign-out, email links (invite/recovery/magic link), user
 * updates, TOTP factors and the admin endpoints, and serves /storage/v1 from
 * storage-emulator.ts. Development only.
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";
import QRCode from "qrcode";
import type { Signer } from "./jwt";
import { newSecret, verifyTotp } from "./totp";
import { createStorageEmulator } from "./storage-emulator";

type UserRow = {
  id: string;
  email: string;
  encrypted_password: string | null;
  raw_app_meta_data: Record<string, unknown>;
  raw_user_meta_data: Record<string, unknown>;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
  banned_until: string | null;
  created_at: string;
  updated_at: string;
};

const ACCESS_TTL = 3600;

export function startAuthEmulator(opts: { port: number; postgrestPort: number; databaseUrl: string; signer: Signer; publicUrl: string; dataDir: string }) {
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 5 });
  const { signer } = opts;
  const issuer = `${opts.publicUrl}/auth/v1`;

  // ---------------------------------------------------------------- helpers
  const hashPassword = (password: string) => {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
  };
  const checkPassword = (password: string, stored: string | null) => {
    if (!stored?.startsWith("scrypt$")) return false;
    const [, saltHex, hashHex] = stored.split("$");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
    const expected = Buffer.from(hashHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  async function getUserById(id: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>("select * from auth.users where id = $1", [id]);
    return rows[0] ?? null;
  }
  async function getUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>("select * from auth.users where lower(email) = lower($1)", [email]);
    return rows[0] ?? null;
  }
  async function factorsFor(userId: string) {
    const { rows } = await pool.query(
      "select id, friendly_name, factor_type, status, created_at, updated_at from auth.mfa_factors where user_id = $1 order by created_at",
      [userId],
    );
    return rows;
  }
  async function userJson(u: UserRow) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: u.email_confirmed_at,
      confirmed_at: u.email_confirmed_at,
      invited_at: u.invited_at,
      phone: "",
      last_sign_in_at: u.last_sign_in_at,
      app_metadata: { provider: "email", providers: ["email"], ...u.raw_app_meta_data },
      user_metadata: u.raw_user_meta_data,
      identities: [],
      factors: await factorsFor(u.id),
      created_at: u.created_at,
      updated_at: u.updated_at,
      is_anonymous: false,
    };
  }

  async function issueSession(u: UserRow, aal: "aal1" | "aal2", method: string, sessionId: string = randomUUID()) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signer.sign({
      aud: "authenticated",
      exp: now + ACCESS_TTL,
      iat: now,
      iss: issuer,
      sub: u.id,
      email: u.email,
      phone: "",
      app_metadata: { provider: "email", providers: ["email"], ...u.raw_app_meta_data },
      user_metadata: u.raw_user_meta_data,
      role: "authenticated",
      aal,
      amr: [{ method, timestamp: now }],
      session_id: sessionId,
      is_anonymous: false,
    });
    const refresh_token = randomBytes(24).toString("base64url");
    await pool.query("insert into auth.refresh_tokens (token, user_id, session_id, aal) values ($1, $2, $3, $4)", [refresh_token, u.id, sessionId, aal]);
    await pool.query("update auth.users set last_sign_in_at = now() where id = $1", [u.id]);
    const fresh = (await getUserById(u.id))!;
    return { access_token, token_type: "bearer", expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token, user: await userJson(fresh) };
  }

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { "content-type": "application/json", ...cors });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, error_code: string, msg: string) => send(res, status, { code: status, error_code, msg });

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version, range, x-retry-count, x-upsert, cache-control, x-metadata, content-encoding",
    "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-expose-headers": "content-range, x-supabase-api-version",
  };

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return {};
    }
  }

  function bearer(req: IncomingMessage) {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
  }
  function claimsOf(req: IncomingMessage) {
    const token = bearer(req);
    return token ? signer.verify(token) : null;
  }
  const isService = (req: IncomingMessage) => claimsOf(req)?.role === "service_role";

  async function createUser(email: string, data: Record<string, unknown> = {}, appMeta: Record<string, unknown> = {}, password?: string, confirmed = false) {
    const { rows } = await pool.query<UserRow>(
      `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, encrypted_password, email_confirmed_at, invited_at)
       values (lower($1), $2, $3, $4, case when $5 then now() end, case when $5 then null else now() end) returning *`,
      [email, data, appMeta, password ? hashPassword(password) : null, confirmed],
    );
    return rows[0];
  }

  async function oneTimeToken(userId: string, type: string) {
    const token = randomBytes(24).toString("hex");
    const hashed = createHash("sha224").update(token).digest("hex");
    await pool.query("insert into auth.one_time_tokens (token_hash, user_id, token_type, expires_at) values ($1, $2, $3, now() + interval '24 hours')", [hashed, userId, type]);
    return hashed;
  }

  // ---------------------------------------------------------------- router
  async function handleAuth(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
    const method = req.method ?? "GET";

    if (path === "/.well-known/jwks.json") return send(res, 200, signer.jwks());
    if (path === "/health") return send(res, 200, { name: "ontriq-local-auth", version: "dev" });
    if (path === "/settings") return send(res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: false });

    if (path === "/token" && method === "POST") {
      const body = await readJson(req);
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const user = await getUserByEmail(String(body.email ?? ""));
        if (!user || !checkPassword(String(body.password ?? ""), user.encrypted_password)) {
          return fail(res, 400, "invalid_credentials", "Invalid login credentials");
        }
        if (user.banned_until && new Date(user.banned_until) > new Date()) return fail(res, 400, "user_banned", "User is banned");
        return send(res, 200, await issueSession(user, "aal1", "password"));
      }
      if (grant === "refresh_token") {
        const { rows } = await pool.query("update auth.refresh_tokens set revoked = true where token = $1 and not revoked returning *", [body.refresh_token]);
        const row = rows[0];
        if (!row) return fail(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        const user = await getUserById(row.user_id);
        if (!user) return fail(res, 400, "user_not_found", "User not found");
        return send(res, 200, await issueSession(user, row.aal, "token_refresh", row.session_id));
      }
      return fail(res, 400, "unsupported_grant_type", "Unsupported grant type");
    }

    if (path === "/logout" && method === "POST") {
      const claims = claimsOf(req);
      if (claims?.session_id) await pool.query("update auth.refresh_tokens set revoked = true where session_id = $1", [claims.session_id]);
      res.writeHead(204, cors);
      return res.end();
    }

    if (path === "/verify" && method === "POST") {
      const body = await readJson(req);
      const { rows } = await pool.query("delete from auth.one_time_tokens where token_hash = $1 and expires_at > now() returning *", [body.token_hash]);
      const row = rows[0];
      if (!row) return fail(res, 403, "otp_expired", "Email link is invalid or has expired");
      await pool.query("update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1", [row.user_id]);
      const user = (await getUserById(row.user_id))!;
      return send(res, 200, await issueSession(user, "aal1", "otp"));
    }

    if (path === "/user") {
      const claims = claimsOf(req);
      if (!claims?.sub) return fail(res, 401, "bad_jwt", "invalid JWT");
      const user = await getUserById(String(claims.sub));
      if (!user) return fail(res, 404, "user_not_found", "User not found");
      if (method === "PUT") {
        const body = await readJson(req);
        if (typeof body.password === "string") {
          if (body.password.length < 6) return fail(res, 422, "weak_password", "Password should be at least 6 characters.");
          if (checkPassword(body.password, user.encrypted_password)) return fail(res, 422, "same_password", "New password should be different from the old password.");
          await pool.query("update auth.users set encrypted_password = $2, updated_at = now() where id = $1", [user.id, hashPassword(body.password)]);
        }
        if (body.data && typeof body.data === "object") {
          await pool.query("update auth.users set raw_user_meta_data = raw_user_meta_data || $2, updated_at = now() where id = $1", [user.id, body.data]);
        }
      }
      return send(res, 200, await userJson((await getUserById(user.id))!));
    }

    // ---- MFA (TOTP)
    const factorMatch = path.match(/^\/factors(?:\/([0-9a-f-]{36})(?:\/(challenge|verify))?)?$/);
    if (factorMatch) {
      const claims = claimsOf(req);
      if (!claims?.sub) return fail(res, 401, "bad_jwt", "invalid JWT");
      const userId = String(claims.sub);
      const [, factorId, action] = factorMatch;

      if (!factorId && method === "POST") {
        const body = await readJson(req);
        const secret = newSecret();
        const user = (await getUserById(userId))!;
        const { rows } = await pool.query(
          "insert into auth.mfa_factors (user_id, friendly_name, factor_type, status, secret) values ($1, $2, 'totp', 'unverified', $3) returning id, friendly_name",
          [userId, body.friendly_name ?? null, secret],
        );
        const issuerName = String(body.issuer ?? "Ontriq");
        const uri = `otpauth://totp/${encodeURIComponent(issuerName)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuerName)}`;
        const svg = await QRCode.toString(uri, { type: "svg", margin: 0 });
        return send(res, 200, {
          id: rows[0].id,
          type: "totp",
          friendly_name: rows[0].friendly_name,
          totp: { qr_code: `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`, secret, uri },
        });
      }
      const { rows: factorRows } = await pool.query("select * from auth.mfa_factors where id = $1 and user_id = $2", [factorId, userId]);
      const factor = factorRows[0];
      if (!factor) return fail(res, 404, "mfa_factor_not_found", "Factor not found");

      if (!action && method === "DELETE") {
        await pool.query("delete from auth.mfa_factors where id = $1", [factorId]);
        return send(res, 200, { id: factorId });
      }
      if (action === "challenge" && method === "POST") {
        return send(res, 200, { id: randomUUID(), type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
      }
      if (action === "verify" && method === "POST") {
        const body = await readJson(req);
        if (!verifyTotp(factor.secret, String(body.code ?? ""))) return fail(res, 422, "mfa_verification_failed", "Invalid TOTP code entered");
        await pool.query("update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1", [factorId]);
        const user = (await getUserById(userId))!;
        return send(res, 200, await issueSession(user, "aal2", "totp", String(claims.session_id ?? randomUUID())));
      }
    }

    // ---- Admin
    if (path.startsWith("/admin/") || path === "/invite") {
      if (!isService(req)) return fail(res, 403, "not_admin", "User not allowed");

      if (path === "/admin/generate_link" && method === "POST") {
        const body = await readJson(req);
        const type = String(body.type);
        const email = String(body.email ?? "").toLowerCase();
        let user = await getUserByEmail(email);
        if (type === "invite") {
          if (user?.email_confirmed_at) return fail(res, 422, "email_exists", "A user with this email address has already been registered");
          user ??= await createUser(email, (body.data as Record<string, unknown>) ?? {});
        } else if (type === "magiclink" || type === "signup") {
          user ??= await createUser(email, (body.data as Record<string, unknown>) ?? {});
        } else if (!user) {
          return fail(res, 404, "user_not_found", "User with this email not found");
        }
        const hashed = await oneTimeToken(user.id, type);
        return send(res, 200, {
          ...(await userJson(user)),
          action_link: `${issuer}/verify?token=${hashed}&type=${type}`,
          email_otp: "000000",
          hashed_token: hashed,
          redirect_to: body.redirect_to ?? opts.publicUrl,
          verification_type: type,
        });
      }

      if (path === "/invite" && method === "POST") {
        const body = await readJson(req);
        const user = (await getUserByEmail(String(body.email))) ?? (await createUser(String(body.email), (body.data as Record<string, unknown>) ?? {}));
        return send(res, 200, await userJson(user));
      }

      if (path === "/admin/users" && method === "POST") {
        const body = await readJson(req);
        if (await getUserByEmail(String(body.email))) return fail(res, 422, "email_exists", "A user with this email address has already been registered");
        const user = await createUser(
          String(body.email),
          (body.user_metadata as Record<string, unknown>) ?? {},
          (body.app_metadata as Record<string, unknown>) ?? {},
          body.password ? String(body.password) : undefined,
          Boolean(body.email_confirm),
        );
        return send(res, 200, await userJson(user));
      }

      if (path === "/admin/users" && method === "GET") {
        const { rows } = await pool.query<UserRow>("select * from auth.users order by created_at");
        return send(res, 200, { users: await Promise.all(rows.map(userJson)), aud: "authenticated" });
      }

      const userMatch = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
      if (userMatch) {
        const user = await getUserById(userMatch[1]);
        if (!user) return fail(res, 404, "user_not_found", "User not found");
        if (method === "GET") return send(res, 200, await userJson(user));
        if (method === "PUT") {
          const body = await readJson(req);
          if (body.app_metadata) await pool.query("update auth.users set raw_app_meta_data = raw_app_meta_data || $2 where id = $1", [user.id, body.app_metadata]);
          if (body.user_metadata) await pool.query("update auth.users set raw_user_meta_data = raw_user_meta_data || $2 where id = $1", [user.id, body.user_metadata]);
          if (typeof body.password === "string") await pool.query("update auth.users set encrypted_password = $2 where id = $1", [user.id, hashPassword(body.password)]);
          if (body.email_confirm === true) await pool.query("update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1", [user.id]);
          if (typeof body.ban_duration === "string") {
            await pool.query("update auth.users set banned_until = case when $2 = 'none' then null else now() + interval '100 years' end where id = $1", [user.id, body.ban_duration]);
          }
          return send(res, 200, await userJson((await getUserById(user.id))!));
        }
        if (method === "DELETE") {
          await pool.query("delete from auth.users where id = $1", [user.id]);
          return send(res, 200, {});
        }
      }
    }

    return fail(res, 404, "not_found", `Not implemented in the local emulator: ${method} ${path}`);
  }

  function proxyRest(req: IncomingMessage, res: ServerResponse, path: string) {
    const headers = { ...req.headers, host: `127.0.0.1:${opts.postgrestPort}` };
    const upstream = http.request(
      { host: "127.0.0.1", port: opts.postgrestPort, method: req.method, path, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
        up.pipe(res);
      },
    );
    upstream.on("error", (error) => fail(res, 502, "postgrest_unreachable", error.message));
    req.pipe(upstream);
  }

  const handleStorage = createStorageEmulator({ dir: opts.dataDir, pool, signer, cors });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
      }
      const url = new URL(req.url ?? "/", "http://local");
      if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url.pathname.slice("/auth/v1".length) || "/", url);
      if (url.pathname.startsWith("/rest/v1")) return proxyRest(req, res, url.pathname.slice("/rest/v1".length) + url.search);
      if (url.pathname.startsWith("/storage/v1")) return await handleStorage(req, res, url.pathname.slice("/storage/v1".length), url);
      return fail(res, 404, "not_found", `No local service for ${url.pathname}`);
    } catch (error) {
      console.error("[auth-emulator]", error);
      fail(res, 500, "unexpected_failure", error instanceof Error ? error.message : "error");
    }
  });
  server.listen(opts.port, "127.0.0.1");
  return { server, pool };
}
