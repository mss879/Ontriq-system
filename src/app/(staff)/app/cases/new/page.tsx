import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getStaffViewer } from "@/lib/server/viewer";
import { clientOptions, getCatalog } from "@/lib/server/cases/queries";
import { can } from "@/domain/permissions";
import { NewCaseWizard } from "./wizard";

export const metadata: Metadata = { title: "New case" };

export default function NewCasePage({ searchParams }: PageProps<"/app/cases/new">) {
  return (
    <Page className="max-w-5xl">
      <div className="space-y-3">
        <Link href="/app/cases" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Cases
        </Link>
        <PageHeader
          eyebrow="New verification"
          title="New case"
          description="Start from a template for one-click setup, or build the request step by step. The case is assigned to the freest qualified officer as soon as it's created."
        />
      </div>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Wizard searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Wizard({ searchParams }: Pick<PageProps<"/app/cases/new">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!can(viewer, "cases.create")) redirect("/app/cases");
  const [catalog, clients] = await Promise.all([getCatalog(), clientOptions()]);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const clientId = one(params.client);
  const templateId = one(params.template);

  return (
    <NewCaseWizard
      clients={clients}
      checkTypes={catalog.checkTypes.filter((t) => t.published && !t.archived)}
      packages={catalog.packages.filter((p) => p.isActive)}
      templates={catalog.templates.filter((t) => t.isActive)}
      initialClientId={clients.some((c) => c.id === clientId) ? clientId : undefined}
      initialTemplateId={catalog.templates.some((t) => t.id === templateId) ? templateId : undefined}
    />
  );
}
