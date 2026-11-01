import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FilePlus2, FolderKanban } from "lucide-react";
import { Page, SectionSkeleton, Eyebrow } from "@/components/layout/page";
import { Surface, SurfaceHeader, TH } from "@/components/admin/surface";
import { ChecksProgress, ResultBadge, shownResult, StagePill, ToneChip } from "@/components/cases/badges";
import { SlaBadge } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaffViewer } from "@/lib/server/viewer";
import { getCatalog } from "@/lib/server/cases/queries";
import { getClientCaseCounts, getClientCases, getClientCheckAccess, getClientContacts, getClientProfile } from "@/lib/server/admin/clients";
import { getClientBuiltPackages, getClientPortalSettings, getClientPortalUsers, getClientRoles } from "@/lib/server/admin/portal";
import { formatDate } from "@/lib/format";
import { can, canAny } from "@/domain/permissions";
import { PROCESS_TYPE_SHORT } from "@/domain/workflow/stages";
import { ClientFormDialog } from "../client-form-dialog";
import { CLIENT_STATUS_TONE, clientStatusLabel } from "../client-status";
import { ContactsCard } from "./contacts-card";
import { CheckAccessCard } from "./check-access-card";
import { PortalUsersCard } from "./portal-users-card";
import { PortalSettingsCard } from "./portal-settings-card";
import { ClientPackagesCard } from "./client-packages-card";
import { ClientQuotesSection } from "./quotes-section";
import { ClientBillingSection } from "./billing-section";

export const metadata: Metadata = { title: "Client" };

export default function ClientPage({ params }: PageProps<"/app/clients/[clientId]">) {
  return (
    <Page>
      <Link href="/app/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Clients
      </Link>
      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <ClientHeader params={params} />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<SectionSkeleton rows={5} />}>
            <RecentCases params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <PortalUsers params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <Contacts params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <ClientPackages params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <ClientQuotesSection params={params} />
          </Suspense>
        </div>
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<SectionSkeleton rows={6} />}>
            <Profile params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={5} />}>
            <ClientBillingSection params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={8} />}>
            <PortalSettings params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={6} />}>
            <CheckAccess params={params} />
          </Suspense>
        </div>
      </div>
    </Page>
  );
}

type Props = Pick<PageProps<"/app/clients/[clientId]">, "params">;

async function load({ params }: Props) {
  const [viewer, { clientId }] = await Promise.all([getStaffViewer(), params]);
  if (!canAny(viewer, ["clients.read", "clients.manage"])) redirect("/app");
  const client = /^[0-9a-f-]{36}$/.test(clientId) ? await getClientProfile(clientId) : null;
  if (!client) notFound();
  return { viewer, client };
}

async function ClientHeader(props: Props) {
  const { viewer, client } = await load(props);
  const counts = await getClientCaseCounts(client.id);
  return (
    <div className="relative overflow-hidden rounded-3xl bg-brand p-6 text-white shadow-lift md:p-8">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,oklch(0.67_0.2_38/0.3),transparent_65%)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 left-10 size-72 rounded-full bg-[radial-gradient(circle,oklch(0.66_0.17_246/0.25),transparent_65%)]" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-3">
          <Eyebrow tone="onDark">Client · {client.code}</Eyebrow>
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-balance md:text-[2.1rem]">{client.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
            <ToneChip tone={CLIENT_STATUS_TONE[client.status]} className="bg-white/10 text-white ring-white/15">
              {clientStatusLabel(client.status)}
            </ToneChip>
            {client.industry ? <span>{client.industry}</span> : null}
            <span aria-hidden>·</span>
            <span>Client since {formatDate(client.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(viewer, "clients.manage") ? (
            <ClientFormDialog
              mode="edit"
              onDark
              clientId={client.id}
              initial={{
                name: client.name,
                code: client.code,
                legalName: client.legalName ?? "",
                registrationNo: client.registrationNo ?? "",
                vatNo: client.vatNo ?? "",
                industry: client.industry ?? "",
                website: client.website ?? "",
                email: client.email ?? "",
                phone: client.phone ?? "",
                address: client.address,
                slaDays: client.slaDays,
                paymentTermsDays: client.paymentTermsDays,
                retentionMonths: client.retentionMonths,
                status: client.status,
                notes: client.notes ?? "",
              }}
            />
          ) : null}
          {can(viewer, "cases.create") && (client.status === "active" || client.status === "prospect") ? (
            <Button asChild className="bg-white text-brand hover:bg-white/90">
              <Link href={`/app/cases/new?client=${client.id}`}>
                <FilePlus2 /> New case
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <dl className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Active cases", value: counts.active },
          { label: "Reports released", value: counts.released },
          { label: "Turnaround", value: `${client.slaDays} days` },
          { label: "Payment terms", value: `${client.paymentTermsDays} days` },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
            <dt className="text-[11px] font-medium tracking-wide text-white/55 uppercase">{s.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

async function Profile(props: Props) {
  const { client } = await load(props);
  const rows: [string, React.ReactNode][] = [
    ["Registered name", client.legalName],
    ["Registration no.", client.registrationNo],
    ["VAT no.", client.vatNo],
    ["Email", client.email ? <a className="hover:underline" href={`mailto:${client.email}`}>{client.email}</a> : null],
    ["Phone", client.phone ? <a className="hover:underline" href={`tel:${client.phone}`}>{client.phone}</a> : null],
    ["Website", client.website ? <a className="hover:underline" href={client.website} target="_blank" rel="noreferrer">{client.website.replace(/^https?:\/\//, "")}</a> : null],
    ["Address", client.address || null],
  ];
  return (
    <Surface>
      <SurfaceHeader title="Company details" />
      <dl className="divide-y text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 px-5 py-2.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value ?? <span className="text-muted-foreground">—</span>}</dd>
          </div>
        ))}
      </dl>
      {client.notes ? (
        <div className="border-t bg-muted/30 px-5 py-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Internal notes</p>
          <p className="mt-1 whitespace-pre-line">{client.notes}</p>
        </div>
      ) : null}
    </Surface>
  );
}

async function Contacts(props: Props) {
  const { viewer, client } = await load(props);
  const contacts = await getClientContacts(client.id);
  return <ContactsCard clientId={client.id} contacts={contacts} canEdit={can(viewer, "clients.manage")} />;
}

async function CheckAccess(props: Props) {
  const { viewer, client } = await load(props);
  const [{ checkTypes }, access] = await Promise.all([getCatalog(), getClientCheckAccess(client.id)]);
  const types = checkTypes.filter((t) => t.published && !t.archived).map((t) => ({ id: t.id, name: t.name, description: t.description, enabled: access.get(t.id) ?? true }));
  return <CheckAccessCard clientId={client.id} types={types} canEdit={can(viewer, "clients.manage")} />;
}

async function ClientPackages(props: Props) {
  const { viewer, client } = await load(props);
  const [packages, { templates, packages: catalog }, settings] = await Promise.all([getClientBuiltPackages(client.id), getCatalog(), getClientPortalSettings(client.id)]);
  const pkgName = new Map(catalog.map((p) => [p.id, p.name]));
  return (
    <ClientPackagesCard
      packages={packages}
      templates={templates
        .filter((t) => t.clientId === client.id)
        .map((t) => ({ id: t.id, name: t.name, packageName: pkgName.get(t.packageId) ?? "Package", processType: PROCESS_TYPE_SHORT[t.processType] }))}
      canApprove={can(viewer, "packages.manage")}
      needsApproval={settings.portal.client_packages_need_approval}
    />
  );
}

async function PortalUsers(props: Props) {
  const { viewer, client } = await load(props);
  const [users, roles] = await Promise.all([getClientPortalUsers(client.id), getClientRoles()]);
  return (
    <PortalUsersCard
      clientId={client.id}
      clientName={client.name}
      users={users}
      roles={roles}
      canEdit={can(viewer, "clients.manage")}
      clientActive={client.status === "active" || client.status === "prospect"}
    />
  );
}

async function PortalSettings(props: Props) {
  const { viewer, client } = await load(props);
  const [{ visibility, portal }, { checkTypes }] = await Promise.all([getClientPortalSettings(client.id), getCatalog()]);
  return (
    <PortalSettingsCard
      clientId={client.id}
      visibility={visibility}
      options={portal}
      checkTypes={checkTypes.filter((t) => t.published && !t.archived).map((t) => ({ id: t.id, name: t.name }))}
      canEdit={can(viewer, "clients.manage")}
    />
  );
}

async function RecentCases(props: Props) {
  const { client } = await load(props);
  const cases = await getClientCases(client.id, 10);
  return (
    <Surface>
      <SurfaceHeader
        title="Recent cases"
        aside={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/cases?client=${client.id}&stage=all`}>
              <FolderKanban /> All cases
            </Link>
          </Button>
        }
      />
      {cases.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No cases yet for this client.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className={`${TH} pl-5`}>Case</TableHead>
              <TableHead className={TH}>Stage</TableHead>
              <TableHead className={`${TH} hidden sm:table-cell`}>Checks</TableHead>
              <TableHead className={`${TH} hidden pr-5 md:table-cell xl:pr-2`}>Result</TableHead>
              <TableHead className={`${TH} hidden pr-5 xl:table-cell`}>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="pl-5">
                  <Link href={`/app/cases/${c.id}`} className="font-medium hover:underline">
                    {c.reference}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.candidateName} · {c.packageName}
                  </span>
                </TableCell>
                <TableCell>
                  <StagePill stage={c.stage} onHold={c.onHold} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <ChecksProgress done={c.checksDone} total={c.checksTotal} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <ResultBadge result={shownResult(c)} />
                </TableCell>
                <TableCell className="hidden pr-5 xl:table-cell">
                  {c.stage === "released" || c.stage === "cancelled" ? (
                    <span className="text-xs text-muted-foreground">{formatDate(c.dueAt)}</span>
                  ) : (
                    <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} compact />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Surface>
  );
}
