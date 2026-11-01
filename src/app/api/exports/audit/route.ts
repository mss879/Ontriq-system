import { connection, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse, exportViewer, readAll } from "@/lib/server/analytics/exports";
import { AUDITED_TABLES, caseAuditFilter, caseIdFor } from "@/lib/server/admin/audit";
import { can } from "@/domain/permissions";
import { csvDateTime, csvFilename } from "@/domain/analytics/csv";

const MAX_ROWS = 10_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What changed in a row, as compact JSON: the changed fields for updates, the row for inserts and deletes. */
function changes(op: string, keys: string[], before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  let out: unknown;
  if (op === "UPDATE") out = Object.fromEntries(keys.map((k) => [k, [before?.[k] ?? null, after?.[k] ?? null]]));
  else out = op === "INSERT" ? after : before;
  const s = JSON.stringify(out ?? {});
  return s.length > 20_000 ? `${s.slice(0, 20_000)}…` : s;
}

/**
 * The audit trail as CSV (audit.read), newest first, with the viewer's
 * filters: table, op, actor ("system" or a user id), q (a case reference),
 * from and to (Sri Lanka days). At most 10,000 rows.
 */
export async function GET(request: NextRequest) {
  await connection();
  const viewer = await exportViewer((v) => can(v, "audit.read"));
  if (viewer instanceof Response) return viewer;
  const sp = request.nextUrl.searchParams;
  const table = sp.get("table");
  const op = sp.get("op");
  const actor = sp.get("actor");
  const from = sp.get("from");
  const to = sp.get("to");
  const supabase = await createClient();
  const caseId = await caseIdFor(supabase, sp.get("q") ?? undefined);

  const build = () => {
    let q = supabase.from("audit_log").select("id, table_name, row_id, op, actor_id, actor_kind, changed_keys, before, after, ip, at");
    if (table && table in AUDITED_TABLES) q = q.eq("table_name", table);
    if (op && ["INSERT", "UPDATE", "DELETE"].includes(op)) q = q.eq("op", op);
    if (actor === "system") q = q.is("actor_id", null);
    else if (actor && /^[0-9a-f-]{36}$/i.test(actor)) q = q.eq("actor_id", actor);
    if (from && DATE.test(from)) q = q.gte("at", `${from}T00:00:00+05:30`);
    if (to && DATE.test(to)) q = q.lte("at", `${to}T23:59:59.999+05:30`);
    // A reference that matches nothing exports nothing.
    if (caseId !== undefined) q = q.or(caseAuditFilter(caseId ?? "00000000-0000-0000-0000-000000000000"));
    return q.order("at", { ascending: false }).order("id", { ascending: false });
  };

  let result;
  try {
    result = await readAll((a, b) => build().range(a, b), MAX_ROWS);
  } catch {
    return Response.json({ error: "The export isn't available right now." }, { status: 503 });
  }
  const actors = [...new Set(result.rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)))];
  const people = new Map<string, string>();
  for (let i = 0; i < actors.length; i += 200) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", actors.slice(i, i + 200));
    for (const p of data ?? []) people.set(p.id, p.full_name || p.email);
  }

  const head = ["When (Sri Lanka)", "Area", "Table", "Record", "Change", "By", "By (kind)", "Fields changed", "Details", "IP"];
  const rows = result.rows.map((r) => [
    csvDateTime(r.at),
    AUDITED_TABLES[r.table_name] ?? r.table_name,
    r.table_name,
    r.row_id,
    r.op === "INSERT" ? "Created" : r.op === "UPDATE" ? "Changed" : "Removed",
    r.actor_id ? (people.get(r.actor_id) ?? r.actor_id) : "System",
    r.actor_kind,
    (r.changed_keys ?? []).join(", "),
    changes(r.op, r.changed_keys ?? [], r.before as Record<string, unknown> | null, r.after as Record<string, unknown> | null),
    r.ip,
  ]);
  if (result.capped) rows.push([`Only the newest ${MAX_ROWS} entries are included. Narrow the dates for the rest.`]);
  return csvResponse([head, ...rows], csvFilename("audit", from && DATE.test(from) ? from : null, to && DATE.test(to) ? `to-${to}` : null));
}
