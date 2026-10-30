/**
 * A small local stand-in for Supabase Storage, mounted at /storage/v1 by the
 * gateway. Implements what Ontriq uses: signed upload URLs (browser uploads),
 * signed download URLs, service uploads, exists, info, list, remove and public
 * reads for public buckets. Bucket rules (public, size limit, allowed types)
 * come from storage.buckets, as on Supabase. Files live under
 * ~/.ontriq/local-stack/storage. Development only.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import type { Signer } from "./jwt";

type Bucket = { id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null };
type Meta = { contentType: string; size: number; createdAt: string };

export function createStorageEmulator(opts: { dir: string; pool: pg.Pool; signer: Signer; cors: Record<string, string> }) {
  const root = path.join(opts.dir, "storage");
  mkdirSync(root, { recursive: true });
  const secret = randomBytes(32);

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", ...opts.cors });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, message: string) => send(res, status, { statusCode: String(status), error: status === 404 ? "not_found" : "Error", message });

  const sign = (payload: Record<string, unknown>) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const verify = (token: string | null, expect: { op: string; bucket: string; key: string }) => {
    if (!token) return false;
    const [body, mac] = token.split(".");
    if (!body || !mac) return false;
    const good = createHmac("sha256", secret).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== good.length || !timingSafeEqual(given, good)) return false;
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { op: string; bucket: string; key: string; exp: number };
    return p.op === expect.op && p.bucket === expect.bucket && p.key === expect.key && p.exp > Date.now() / 1000;
  };

  const isService = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const claims = token ? (opts.signer.verify(token) as { role?: string } | null) : null;
    return claims?.role === "service_role";
  };

  async function bucket(id: string): Promise<Bucket | null> {
    const { rows } = await opts.pool.query<Bucket>("select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1", [id]);
    return rows[0] ?? null;
  }

  const fileOf = (b: string, key: string) => path.join(root, b, key);
  const metaOf = (b: string, key: string) => `${fileOf(b, key)}.meta.json`;
  const readMeta = (b: string, key: string): Meta | null => (existsSync(metaOf(b, key)) ? (JSON.parse(readFileSync(metaOf(b, key), "utf8")) as Meta) : null);

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** The uploaded bytes and type, from a raw body or the multipart form supabase-js sends from browsers. */
  async function fileFrom(req: IncomingMessage): Promise<{ bytes: Buffer; type: string }> {
    const raw = await readBody(req);
    const type = String(req.headers["content-type"] ?? "application/octet-stream");
    if (type.startsWith("multipart/form-data")) {
      const form = await new Response(new Uint8Array(raw), { headers: { "content-type": type } }).formData();
      for (const [, value] of form.entries()) {
        if (typeof value !== "string") return { bytes: Buffer.from(await value.arrayBuffer()), type: value.type || "application/octet-stream" };
      }
      throw new Error("no file in form");
    }
    return { bytes: raw, type: type.split(";")[0].trim() };
  }

  async function store(res: ServerResponse, b: Bucket, key: string, file: { bytes: Buffer; type: string }) {
    if (b.file_size_limit && file.bytes.length > b.file_size_limit) return fail(res, 413, "The object exceeded the maximum allowed size");
    if (b.allowed_mime_types?.length && !b.allowed_mime_types.includes(file.type)) return fail(res, 415, `mime type ${file.type} is not supported`);
    mkdirSync(path.dirname(fileOf(b.id, key)), { recursive: true });
    writeFileSync(fileOf(b.id, key), file.bytes);
    writeFileSync(metaOf(b.id, key), JSON.stringify({ contentType: file.type, size: file.bytes.length, createdAt: new Date().toISOString() } satisfies Meta));
    return send(res, 200, { Key: `${b.id}/${key}`, Id: `${b.id}/${key}` });
  }

  function serve(res: ServerResponse, b: string, key: string, download: string | null) {
    const meta = readMeta(b, key);
    if (!meta || !existsSync(fileOf(b, key))) return fail(res, 404, "Object not found");
    const headers: Record<string, string> = { ...opts.cors, "content-type": meta.contentType, "content-length": String(meta.size), "cache-control": "no-store" };
    headers["content-disposition"] =
      download !== null ? `attachment; filename="${(download || path.basename(key)).replace(/"/g, "")}"` : `inline; filename="${path.basename(key).replace(/"/g, "")}"`;
    res.writeHead(200, headers);
    createReadStream(fileOf(b, key)).pipe(res);
  }

  /** Split "/bucket/a/b.pdf" into bucket and key, refusing anything that escapes the store. */
  const split = (rest: string): { b: string; key: string } | null => {
    const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length < 1 || parts.some((p) => p === ".." || p.includes("\0"))) return null;
    return { b: parts[0], key: parts.slice(1).join("/") };
  };

  return async function handleStorage(req: IncomingMessage, res: ServerResponse, p: string, url: URL) {
    const method = req.method ?? "GET";
    const route = (prefix: string) => (p.startsWith(prefix) ? split(p.slice(prefix.length)) : null);

    let m = route("/object/upload/sign/");
    if (m) {
      const b = await bucket(m.b);
      if (!b || !m.key) return fail(res, 404, "Bucket not found");
      if (method === "POST") {
        if (!isService(req)) return fail(res, 403, "signature required");
        const token = sign({ op: "upload", bucket: b.id, key: m.key, exp: Math.floor(Date.now() / 1000) + 7200 });
        return send(res, 200, { url: `/object/upload/sign/${b.id}/${m.key}?token=${token}` });
      }
      if (method === "PUT") {
        if (!verify(url.searchParams.get("token"), { op: "upload", bucket: b.id, key: m.key })) return fail(res, 400, "invalid signature");
        return store(res, b, m.key, await fileFrom(req));
      }
    }

    m = route("/object/sign/");
    if (m) {
      const b = await bucket(m.b);
      if (!b || !m.key) return fail(res, 404, "Bucket not found");
      if (method === "POST") {
        if (!isService(req)) return fail(res, 403, "signature required");
        const body = JSON.parse((await readBody(req)).toString() || "{}") as { expiresIn?: number };
        const token = sign({ op: "read", bucket: b.id, key: m.key, exp: Math.floor(Date.now() / 1000) + Math.max(1, body.expiresIn ?? 60) });
        return send(res, 200, { signedURL: `/object/sign/${b.id}/${m.key}?token=${token}` });
      }
      if (method === "GET") {
        if (!verify(url.searchParams.get("token"), { op: "read", bucket: b.id, key: m.key })) return fail(res, 400, "invalid signature");
        return serve(res, b.id, m.key, url.searchParams.has("download") ? url.searchParams.get("download") : null);
      }
    }

    m = route("/object/public/");
    if (m && method === "GET") {
      const b = await bucket(m.b);
      if (!b?.public) return fail(res, 400, "Bucket not found or not public");
      return serve(res, b.id, m.key, url.searchParams.has("download") ? url.searchParams.get("download") : null);
    }

    m = route("/object/info/");
    if (m && method === "GET") {
      if (!isService(req)) return fail(res, 403, "not allowed");
      const meta = readMeta(m.b, m.key);
      if (!meta) return fail(res, 404, "Object not found");
      return send(res, 200, { id: `${m.b}/${m.key}`, name: m.key, bucket_id: m.b, size: meta.size, content_type: meta.contentType, created_at: meta.createdAt, updated_at: meta.createdAt });
    }

    m = route("/object/list/");
    if (m && method === "POST") {
      if (!isService(req)) return fail(res, 403, "not allowed");
      const body = JSON.parse((await readBody(req)).toString() || "{}") as { prefix?: string; limit?: number };
      const dir = path.join(root, m.b, body.prefix ?? "");
      if (!dir.startsWith(path.join(root, m.b)) || !existsSync(dir) || !statSync(dir).isDirectory()) return send(res, 200, []);
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.endsWith(".meta.json"))
        .slice(0, body.limit ?? 100)
        .map((e) => (e.isDirectory() ? { name: e.name, id: null, metadata: null } : { name: e.name, id: `${m!.b}/${body.prefix ?? ""}/${e.name}`, metadata: readMeta(m!.b, path.join(body.prefix ?? "", e.name)) }));
      return send(res, 200, entries);
    }

    m = route("/object/");
    if (m) {
      if (!isService(req)) return fail(res, 403, "not allowed");
      if (method === "HEAD") {
        const exists = Boolean(readMeta(m.b, m.key));
        res.writeHead(exists ? 200 : 404, opts.cors);
        return res.end();
      }
      if (method === "DELETE" && !m.key) {
        const body = JSON.parse((await readBody(req)).toString() || "{}") as { prefixes?: string[] };
        const removed = [];
        for (const key of body.prefixes ?? []) {
          const s = split(`/${m.b}/${key}`);
          if (!s || !readMeta(s.b, s.key)) continue;
          rmSync(fileOf(s.b, s.key), { force: true });
          rmSync(metaOf(s.b, s.key), { force: true });
          removed.push({ name: s.key, bucket_id: s.b });
        }
        return send(res, 200, removed);
      }
      if ((method === "POST" || method === "PUT") && m.key) {
        const b = await bucket(m.b);
        if (!b) return fail(res, 404, "Bucket not found");
        return store(res, b, m.key, await fileFrom(req));
      }
      if (method === "GET" && m.key) return serve(res, m.b, m.key, null);
    }

    return fail(res, 404, `Not implemented in the local storage emulator: ${method} ${p}`);
  };
}
