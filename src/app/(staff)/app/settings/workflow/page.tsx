import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getStaffViewer } from "@/lib/server/viewer";
import { createRequestClient } from "@/lib/supabase/server";
import { can } from "@/domain/permissions";
import { getWorkflowSettings } from "@/lib/server/cases/status-catalog";
import { DocumentTypes, OwnStatuses, StatusWording, WorkflowRules } from "./workflow-forms";

export const metadata: Metadata = { title: "Workflow" };

export default function WorkflowSettingsPage() {
  return (
    <Page>
      <PageHeader eyebrow="Administration" title="Workflow" description="How statuses read, your own statuses, QC checklists, the order checks run in, and the kinds of document cases can ask for." />
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
  const [{ data: statuses }, { data: categories }, rules] = await Promise.all([
    supabase.from("client_status_catalog").select("key, internal_label, client_label, candidate_label, sort, is_custom, is_active").order("sort"),
    supabase.from("document_categories").select("id, key, name, guide, sensitive, in_report, is_active, needs_original, sort").order("sort"),
    getWorkflowSettings(viewer.orgId),
  ]);
  return (
    <div className="space-y-5">
      {canStatuses ? <StatusWording rows={(statuses ?? []).filter((s) => !s.is_custom)} /> : null}
      {canStatuses ? <OwnStatuses rows={(statuses ?? []).filter((s) => s.is_custom)} /> : null}
      {canStatuses ? <WorkflowRules rules={rules} /> : null}
      {canDocuments ? <DocumentTypes rows={categories ?? []} /> : null}
    </div>
  );
}
