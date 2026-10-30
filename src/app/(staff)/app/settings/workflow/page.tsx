import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getStaffViewer } from "@/lib/server/viewer";
import { createRequestClient } from "@/lib/supabase/server";
import { can } from "@/domain/permissions";
import { DocumentTypes, StatusWording } from "./workflow-forms";

export const metadata: Metadata = { title: "Workflow" };

export default function WorkflowSettingsPage() {
  return (
    <Page>
      <PageHeader eyebrow="Administration" title="Workflow" description="How statuses read to clients and candidates, and the kinds of document cases can ask for." />
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </Page>
  );
}

async function Content() {
  const viewer = await getStaffViewer();
  const canStatuses = can(viewer, "settings.manage");
  const canDocuments = can(viewer, "check_types.manage");
  if (!canStatuses && !canDocuments) redirect("/app/settings");
  const supabase = await createRequestClient();
  const [{ data: statuses }, { data: categories }] = await Promise.all([
    supabase.from("client_status_catalog").select("key, internal_label, client_label, candidate_label, sort").order("sort"),
    supabase.from("document_categories").select("id, key, name, guide, sensitive, in_report, is_active, sort").order("sort"),
  ]);
  return (
    <div className="space-y-5">
      {canStatuses ? <StatusWording rows={statuses ?? []} /> : null}
      {canDocuments ? <DocumentTypes rows={categories ?? []} /> : null}
    </div>
  );
}
