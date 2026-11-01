import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getClientViewer } from "@/lib/server/viewer";
import { portalPackages, portalSettings, portalTemplates } from "@/lib/server/portal/queries";
import { can } from "@/domain/permissions";
import { NewRequest } from "./new-request";

export const metadata: Metadata = { title: "New request" };

export default function NewRequestPage({ searchParams }: PageProps<"/portal/cases/new">) {
  return (
    <Page>
      <PageHeader
        eyebrow="Verifications"
        title="New request"
        description="Send a candidate to Ontriq. Pick a template or package, add the candidate's details, and follow every check from your portal."
      />
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/portal/cases/new">, "searchParams">) {
  const [viewer, sp] = await Promise.all([getClientViewer(), searchParams]);
  if (!can(viewer, "portal.cases.create")) redirect("/portal/cases");
  const [templates, packages, settings] = await Promise.all([portalTemplates(), portalPackages(), portalSettings()]);
  const usable = packages.filter((p) => p.is_active);
  const usableIds = new Set(usable.map((p) => p.id));
  const live = templates.filter((t) => t.is_active && usableIds.has(t.package_id));
  const wanted = typeof sp.template === "string" ? sp.template : undefined;
  return <NewRequest templates={live} packages={usable} bulkEnabled={settings.bulk_upload} initialTemplateId={live.some((t) => t.id === wanted) ? wanted : undefined} />;
}
