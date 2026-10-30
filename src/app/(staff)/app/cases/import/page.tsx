import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getStaffViewer } from "@/lib/server/viewer";
import { clientOptions, getCatalog } from "@/lib/server/cases/queries";
import { can } from "@/domain/permissions";
import { ImportCases } from "./import-cases";

export const metadata: Metadata = { title: "Import cases" };

export default function ImportCasesPage({ searchParams }: PageProps<"/app/cases/import">) {
  return (
    <Page className="max-w-6xl">
      <div className="space-y-3">
        <Link href="/app/cases" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Cases
        </Link>
        <PageHeader
          eyebrow="New verification"
          title="Import cases"
          description="Create many cases for one client from a spreadsheet. Check the preview, fix what's flagged, then create them all at once; each case is assigned like any other."
        />
      </div>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Importer searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Importer({ searchParams }: Pick<PageProps<"/app/cases/import">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!can(viewer, "cases.create")) redirect("/app/cases");
  const [catalog, clients] = await Promise.all([getCatalog(), clientOptions()]);
  const clientId = Array.isArray(params.client) ? params.client[0] : params.client;
  return (
    <ImportCases
      clients={clients.map(({ id, name, code }) => ({ id, name, code }))}
      canAddClient={can(viewer, "clients.manage")}
      packages={catalog.packages
        .filter((p) => p.isActive)
        .map((p) => ({ id: p.id, name: p.name, code: p.code, clientId: p.ownerScope === "client" ? p.clientId : null, checks: p.items.length, tatDays: p.tatDays, defaultProcessType: p.defaultProcessType }))}
      templates={catalog.templates
        .filter((t) => t.isActive)
        .map((t) => ({ id: t.id, name: t.name, clientId: t.clientId, packageId: t.packageId, processType: t.processType, priority: t.priority }))}
      initialClientId={clients.some((c) => c.id === clientId) ? clientId : undefined}
    />
  );
}
