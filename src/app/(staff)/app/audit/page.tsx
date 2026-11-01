import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { History } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ListFilters } from "@/components/admin/list-filters";
import { one, pageParam, Pagination } from "@/components/admin/pagination";
import { Surface } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { PersonAvatar } from "@/components/cases/person";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getStaffViewer } from "@/lib/server/viewer";
import { peopleById, staffOptions } from "@/lib/server/cases/queries";
import { AUDIT_PAGE_SIZE, AUDITED_TABLES, listAudit, type AuditRow } from "@/lib/server/admin/audit";
import { formatDateTime } from "@/lib/format";
import { can } from "@/domain/permissions";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage({ searchParams }: PageProps<"/app/audit">) {
  return (
    <Page>
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        description="Every change to cases, checks, documents, QC decisions, reports, clients, people and settings, with who made it and when. Nobody can edit or delete an entry. Erasing a case's personal data blanks its entries but keeps who did what and when."
      />
      <Suspense fallback={null}>
        <Filters />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <AuditList searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Filters() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "audit.read")) redirect("/app");
  const staff = await staffOptions();
  return (
    <ListFilters
      placeholder="Case reference, e.g. ONT-2026-000123"
      selects={[
        {
          name: "table",
          label: "Area",
          allLabel: "Every area",
          className: "sm:w-52",
          options: Object.entries(AUDITED_TABLES)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([value, label]) => ({ value, label })),
        },
        {
          name: "op",
          label: "Change",
          allLabel: "Any change",
          options: [
            { value: "INSERT", label: "Created" },
            { value: "UPDATE", label: "Changed" },
            { value: "DELETE", label: "Removed" },
          ],
        },
        { name: "actor", label: "Person", allLabel: "Anyone", className: "sm:w-52", options: [{ value: "system", label: "System and automation" }, ...staff.map((s) => ({ value: s.id, label: s.name }))] },
      ]}
      dates={[
        { name: "from", label: "From" },
        { name: "to", label: "To" },
      ]}
    />
  );
}

const OP: Record<AuditRow["op"], { label: string; tone: "success" | "info" | "danger" }> = {
  INSERT: { label: "Created", tone: "success" },
  UPDATE: { label: "Changed", tone: "info" },
  DELETE: { label: "Removed", tone: "danger" },
};

const ACTOR: Record<string, string> = { system: "System", candidate: "The candidate", worker: "Background job" };

const HIDDEN_KEYS = new Set(["updated_at", "created_at", "org_id", "id"]);

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function label(key: string) {
  return key.replace(/_/g, " ");
}

async function AuditList({ searchParams }: Pick<PageProps<"/app/audit">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!can(viewer, "audit.read")) return null;
  const filters = { table: one(params.table), op: one(params.op), actor: one(params.actor), from: one(params.from), to: one(params.to), caseRef: one(params.q), page: pageParam(params.page) };
  const [{ rows, total }, people] = await Promise.all([listAudit(filters), peopleById()]);
  const exportQuery = new URLSearchParams(Object.entries({ q: filters.caseRef, table: filters.table, op: filters.op, actor: filters.actor, from: filters.from, to: filters.to }).flatMap(([k, v]) => (v ? [[k, v]] : []))).toString();

  if (!rows.length) {
    return (
      <Surface>
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History />
            </EmptyMedia>
            <EmptyTitle>No entries</EmptyTitle>
            <EmptyDescription>Nothing matches these filters.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Surface>
    );
  }

  return (
    <Surface>
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <p className="text-sm font-semibold">{total.toLocaleString("en-GB")} entries</p>
        <p className="flex items-center gap-3 text-xs text-muted-foreground">
          Times in Sri Lanka time
          <a href={`/api/exports/audit${exportQuery ? `?${exportQuery}` : ""}`} className="font-medium text-primary hover:underline dark:text-brand-sky">
            Export CSV
          </a>
        </p>
      </div>
      <ol className="divide-y">
        {rows.map((r) => {
          const person = r.actorId ? people.get(r.actorId) : null;
          const keys =
            r.op === "UPDATE"
              ? r.changedKeys.filter((k) => !HIDDEN_KEYS.has(k))
              : Object.keys((r.op === "INSERT" ? r.after : r.before) ?? {}).filter((k) => !HIDDEN_KEYS.has(k));
          const name =
            (r.after?.name as string | undefined) ??
            (r.before?.name as string | undefined) ??
            (r.after?.reference as string | undefined) ??
            (r.after?.label as string | undefined) ??
            (r.after?.full_name as string | undefined) ??
            (r.after?.filename as string | undefined);
          return (
            <li key={r.id}>
              <details className="group/row">
                <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3 hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
                  {person ? (
                    <PersonAvatar id={person.id} name={person.name} size="sm" className="mt-0.5" />
                  ) : (
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-semibold text-muted-foreground">SYS</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{person?.name ?? ACTOR[r.actorKind] ?? r.actorKind}</span>{" "}
                      <span className="text-muted-foreground">{OP[r.op].label.toLowerCase()}</span> {AUDITED_TABLES[r.table] ?? r.table}
                      {name ? <span className="font-medium"> · {name}</span> : null}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ToneChip tone={OP[r.op].tone} className="h-5 px-2 text-[11px]">
                        {OP[r.op].label}
                      </ToneChip>
                      {r.op === "UPDATE"
                        ? keys.slice(0, 6).map((k) => (
                            <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {label(k)}
                            </span>
                          ))
                        : null}
                      {r.op === "UPDATE" && keys.length > 6 ? <span className="text-[11px] text-muted-foreground">+{keys.length - 6}</span> : null}
                    </div>
                  </div>
                  <time dateTime={r.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(r.at)}
                  </time>
                </summary>
                <div className="border-t bg-muted/20 px-5 py-3">
                  {keys.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No field changes recorded.</p>
                  ) : (
                    <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
                      {keys.slice(0, 40).map((k) => (
                        <div key={k} className="contents">
                          <dt className="font-medium text-muted-foreground">{label(k)}</dt>
                          <dd className="min-w-0 font-mono break-all">
                            {r.op === "UPDATE" ? (
                              <>
                                <span className="text-destructive line-through decoration-destructive/40">{show(r.before?.[k])}</span>
                                <span className="mx-1.5 text-muted-foreground">to</span>
                                <span className="text-success">{show(r.after?.[k])}</span>
                              </>
                            ) : (
                              show((r.op === "INSERT" ? r.after : r.before)?.[k])
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="mt-2.5 text-[11px] text-muted-foreground">
                    Record {r.rowId}
                    {r.ip ? ` · from ${r.ip}` : ""}
                  </p>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      <Pagination page={filters.page} pageSize={AUDIT_PAGE_SIZE} total={total} params={{ q: filters.caseRef, table: filters.table, op: filters.op, actor: filters.actor, from: filters.from, to: filters.to }} basePath="/app/audit" />
    </Surface>
  );
}
