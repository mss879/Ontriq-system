import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getStaffViewer } from "@/lib/server/viewer";
import { getCatalog } from "@/lib/server/cases/queries";
import { getAssignmentRules, staffLoad, upcomingLeave } from "@/lib/server/admin/settings";
import { getPerformanceRules } from "@/lib/server/performance/queries";
import { can } from "@/domain/permissions";
import { PerformanceRulesForm } from "./performance-form";
import { RulesForm } from "./rules-form";
import { StaffTable } from "./staff-table";

export const metadata: Metadata = { title: "Assignment" };

export default function AssignmentPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Administration"
        title="Assignment"
        description="New cases go to the freest qualified officer automatically, with a written reason on the case. Managers can always reassign by hand."
      />
      <Alert>
        <Info />
        <AlertTitle>Who gets work automatically</AlertTitle>
        <AlertDescription>
          Anyone who can verify checks is eligible unless switched off below. Super Admins, Admins, Operations Managers, Client Relations and Viewers are switched off
          until you turn them on. People on leave, at capacity, or not set up for a check are skipped.
        </AlertDescription>
      </Alert>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <Rules />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Staff />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <Performance />
      </Suspense>
    </Page>
  );
}

async function Rules() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "assignment.configure")) redirect("/app");
  const rules = await getAssignmentRules(viewer.orgId);
  return <RulesForm rules={rules} />;
}

async function Performance() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "assignment.configure")) return null;
  const rules = await getPerformanceRules(viewer.orgId);
  return <PerformanceRulesForm key={JSON.stringify(rules)} rules={rules} />;
}

async function Staff() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "assignment.configure")) return null;
  const [staff, leave, { checkTypes }] = await Promise.all([staffLoad(), upcomingLeave(), getCatalog()]);
  return (
    <StaffTable
      staff={staff}
      leave={leave}
      checkTypes={checkTypes.filter((t) => t.published && !t.archived).map((t) => ({ id: t.id, name: t.name, locationBound: t.locationBound }))}
    />
  );
}
