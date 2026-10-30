import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ListFilters } from "@/components/admin/list-filters";
import { one } from "@/components/admin/pagination";
import { Surface, TH } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaffViewer } from "@/lib/server/viewer";
import { listClients } from "@/lib/server/admin/clients";
import { can, canAny } from "@/domain/permissions";
import { ClientFormDialog } from "./client-form-dialog";
import { CLIENT_STATUS_TONE, STATUS_OPTIONS, clientStatusLabel } from "./client-status";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage({ searchParams }: PageProps<"/app/clients">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Directory" title="Clients" description="Companies that order verifications from Ontriq." />}>
        <Header />
      </Suspense>
      <Suspense fallback={null}>
        <ListFilters
          placeholder="Search by name, code or industry"
          selects={[{ name: "status", label: "Status", allLabel: "All but archived", options: [...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label })), { value: "all", label: "Everything" }] }]}
        />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <ClientList searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Header() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, ["clients.read", "clients.manage"])) redirect("/app");
  return (
    <PageHeader
      eyebrow="Directory"
      title="Clients"
      description="Companies that order verifications from Ontriq, their contacts and the checks they may order."
      actions={can(viewer, "clients.manage") ? <ClientFormDialog mode="create" /> : null}
    />
  );
}

async function ClientList({ searchParams }: Pick<PageProps<"/app/clients">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!canAny(viewer, ["clients.read", "clients.manage"])) return null;
  const q = one(params.q);
  const status = one(params.status);
  const clients = await listClients({ q, status });

  if (!clients.length) {
    return (
      <Surface>
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>{q || status ? "No clients match" : "No clients yet"}</EmptyTitle>
            <EmptyDescription>{q || status ? "Try another search or status." : "Add the first company that orders verifications."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Surface>
    );
  }

  return (
    <Surface>
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <p className="text-sm font-semibold">
          {clients.length} {clients.length === 1 ? "client" : "clients"}
        </p>
        <p className="text-xs text-muted-foreground">{clients.reduce((a, c) => a + c.activeCases, 0)} active cases</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className={`${TH} pl-5`}>Client</TableHead>
            <TableHead className={`${TH} hidden md:table-cell`}>Contact</TableHead>
            <TableHead className={TH}>Status</TableHead>
            <TableHead className={`${TH} text-right`}>Active</TableHead>
            <TableHead className={`${TH} hidden pr-5 text-right sm:table-cell`}>All cases</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => (
            <TableRow key={c.id} className="group">
              <TableCell className="pl-5">
                <Link href={`/app/clients/${c.id}`} className="flex min-w-0 items-center gap-3 outline-none">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-[11px] font-semibold text-primary ring-1 ring-primary/15">
                    {c.code.slice(0, 3)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium group-hover:underline">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.code}
                      {c.industry ? ` · ${c.industry}` : ""}
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="hidden max-w-56 md:table-cell">
                <span className="block truncate text-sm">{c.email ?? "—"}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.phone ?? ""}</span>
              </TableCell>
              <TableCell>
                <ToneChip tone={CLIENT_STATUS_TONE[c.status]}>{clientStatusLabel(c.status)}</ToneChip>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{c.activeCases}</TableCell>
              <TableCell className="hidden pr-5 text-right text-muted-foreground tabular-nums sm:table-cell">{c.totalCases}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Surface>
  );
}
