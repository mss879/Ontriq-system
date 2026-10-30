import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getStaffViewer } from "@/lib/server/viewer";
import { clientOptions, getCatalog } from "@/lib/server/cases/queries";
import { packageVisibility } from "@/lib/server/admin/settings";
import { can, canAny } from "@/domain/permissions";
import { PackagesManager } from "./packages-manager";
import { TemplatesManager } from "./templates-manager";

export const metadata: Metadata = { title: "Packages and templates" };

export default function PackagesPage() {
  return (
    <Page className="max-w-5xl">
      <PageHeader
        eyebrow="Administration"
        title="Packages and templates"
        description="Packages bundle checks at a price and turnaround. Request templates prefill a new case in one click: package, process type and instructions."
      />
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </Page>
  );
}

async function Content() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, ["packages.manage", "templates.manage"])) redirect("/app");
  const [{ packages, templates, checkTypes }, visibility, clients] = await Promise.all([getCatalog(), packageVisibility(), clientOptions()]);
  const orgPackages = packages.filter((p) => p.ownerScope === "org");
  const usableTypes = checkTypes.filter((t) => t.published && !t.archived);
  return (
    <div className="space-y-8">
      <PackagesManager
        canEdit={can(viewer, "packages.manage")}
        packages={orgPackages.map((p) => ({ ...p, clientIds: visibility.get(p.id) ?? [] }))}
        checkTypes={usableTypes.map((t) => ({ id: t.id, name: t.name, slaDays: t.slaDays }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
      />
      <TemplatesManager
        canEdit={can(viewer, "templates.manage")}
        templates={templates.filter((t) => t.ownerScope === "org")}
        packages={orgPackages.map((p) => ({ id: p.id, name: p.name, active: p.isActive, defaultProcessType: p.defaultProcessType }))}
      />
    </div>
  );
}
