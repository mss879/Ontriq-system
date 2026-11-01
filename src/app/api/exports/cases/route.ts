import { connection, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse, exportViewer, readAll } from "@/lib/server/analytics/exports";
import { canAny } from "@/domain/permissions";
import { csvDateTime, csvFilename } from "@/domain/analytics/csv";
import { colomboToday } from "@/domain/analytics/period";
import { ACTIVE_STAGES, STAGES, STAGE_LABELS, type Stage } from "@/domain/workflow/stages";
import { statusLabeller } from "@/lib/server/cases/status-catalog";

const MAX_ROWS = 5000;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The cases list as CSV, with the same filters as /app/cases (q, stage,
 * client, assignee, priority, due). Row level security limits it to the
 * cases the person can see; at most 5,000 rows, newest first.
 */
export async function GET(request: NextRequest) {
  await connection();
  const viewer = await exportViewer((v) => canAny(v, ["cases.read", "cases.read_assigned"]));
  if (viewer instanceof Response) return viewer;
  const sp = request.nextUrl.searchParams;
  const one = (k: string) => sp.get(k)?.trim() || undefined;
  const supabase = await createClient();

  const build = () => {
    let q = supabase
      .from("cases")
      .select(
        "id, reference, candidate_name, client_reference, stage, status_key, priority, on_hold, proposed_result, final_result, checks_total, checks_done, assigned_to, process_type, package_snapshot, position_title, received_at, due_at, released_at, client:clients(name, code)",
      );
    const stage = one("stage") ?? "active";
    if (stage === "active") q = q.in("stage", ACTIVE_STAGES);
    else if (stage === "closed") q = q.in("stage", ["released", "cancelled"]);
    else if (stage === "on_hold") q = q.eq("on_hold", true);
    else if (stage !== "all" && (STAGES as readonly string[]).includes(stage)) q = q.eq("stage", stage as Stage);
    const client = one("client");
    if (client && UUID.test(client)) q = q.eq("client_id", client);
    const priority = one("priority");
    if (priority && ["normal", "high", "urgent"].includes(priority)) q = q.eq("priority", priority);
    const assignee = one("assignee");
    if (assignee === "me") q = q.eq("assigned_to", viewer.userId);
    else if (assignee === "unassigned") q = q.is("assigned_to", null);
    else if (assignee && UUID.test(assignee)) q = q.eq("assigned_to", assignee);
    if (one("due") === "overdue") q = q.lt("due_at", new Date().toISOString()).in("stage", ACTIVE_STAGES);
    if (one("due") === "this_week") q = q.lt("due_at", new Date(Date.now() + 7 * 864e5).toISOString()).in("stage", ACTIVE_STAGES);
    const term = one("q")?.replace(/[%_,()]/g, " ").trim();
    if (term) q = q.or(`reference.ilike.%${term}%,candidate_name.ilike.%${term}%,client_reference.ilike.%${term}%`);
    return q.order("received_at", { ascending: false }).order("id");
  };

  let result;
  try {
    result = await readAll((from, to) => build().range(from, to), MAX_ROWS);
  } catch {
    return Response.json({ error: "The export isn't available right now." }, { status: 503 });
  }
  const statusName = await statusLabeller();
  const owners = [...new Set(result.rows.map((r) => r.assigned_to).filter((x): x is string => Boolean(x)))];
  const people = new Map<string, string>();
  for (let i = 0; i < owners.length; i += 200) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", owners.slice(i, i + 200));
    for (const p of data ?? []) people.set(p.id, p.full_name || p.email);
  }

  const head = ["Reference", "Candidate", "Client", "Client code", "Client reference", "Position", "Package", "Documents from", "Stage", "Status", "Priority", "On hold", "Proposed result", "Final result", "Checks done", "Checks total", "Owner", "Received", "Due", "Released"];
  const rows = result.rows.map((c) => {
    const client = c.client as unknown as { name: string; code: string } | null;
    return [
      c.reference,
      c.candidate_name,
      client?.name,
      client?.code,
      c.client_reference,
      c.position_title,
      ((c.package_snapshot as { name?: string } | null)?.name ?? "") || "Custom",
      c.process_type === "candidate_collected" ? "Candidate" : "Client",
      STAGE_LABELS[c.stage as Stage] ?? c.stage,
      statusName(c.status_key),
      c.priority,
      c.on_hold ? "Yes" : "No",
      c.proposed_result,
      c.final_result,
      c.checks_done,
      c.checks_total,
      c.assigned_to ? (people.get(c.assigned_to) ?? "Team member") : "",
      csvDateTime(c.received_at),
      csvDateTime(c.due_at),
      csvDateTime(c.released_at),
    ];
  });
  if (result.capped) rows.push([`Only the newest ${MAX_ROWS} cases are included. Narrow the filters for the rest.`]);
  return csvResponse([head, ...rows], csvFilename("cases", colomboToday()));
}
