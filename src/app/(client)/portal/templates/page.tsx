import { Suspense } from "react";
import Link from "@/components/link";
import type { Metadata } from "next";
import { ArrowRight, LayoutTemplate } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ToneChip, PriorityBadge } from "@/components/cases/badges";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getClientViewer } from "@/lib/server/viewer";
import { portalPackages, portalTemplates } from "@/lib/server/portal/queries";
import { formatDate } from "@/lib/format";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";
import { TemplateButton, TemplateFlags } from "./template-dialog";

export const metadata: Metadata = { title: "Templates" };

const DESCRIPTION = "Save the package and details you use for a role. In New request, one click fills everything in.";

export default function TemplatesPage() {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Catalogue" title="Request templates" description={DESCRIPTION} />}>
        <Header />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <Content />
      </Suspense>
    </Page>
  );
}

async function data() {
  const [viewer, packages] = await Promise.all([getClientViewer(), portalPackages()]);
  const usable = packages.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, default_process_type: p.default_process_type }));
  return { viewer, packages, usable, manage: can(viewer, "portal.templates.manage") };
}

async function Header() {
  const { usable, manage } = await data();
  return <PageHeader eyebrow="Catalogue" title="Request templates" description={DESCRIPTION} actions={manage ? <TemplateButton packages={usable} /> : null} />;
}

async function Content() {
  const [{ viewer, packages, usable, manage }, templates] = await Promise.all([data(), portalTemplates()]);
  const byId = new Map(packages.map((p) => [p.id, p]));
  if (!templates.length) {
    return (
      <div className="rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutTemplate />
            </EmptyMedia>
            <EmptyTitle>No templates yet</EmptyTitle>
            <EmptyDescription>
              {manage ? "Create one for a role you hire often, like branch staff or drivers." : "Your portal admin can create templates for your company."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  const canRequest = can(viewer, "portal.cases.create");
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {templates.map((t) => {
        const pkg = byId.get(t.package_id);
        return (
          <li key={t.id} className={cn("flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]", !t.is_active && "opacity-75")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{t.name}</h3>
                {t.description ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{t.description}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!t.is_active ? <ToneChip tone="neutral">Archived</ToneChip> : null}
                <PriorityBadge priority={t.priority} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Package</dt>
              <dd className="truncate text-right">{pkg?.name ?? "Unavailable"}</dd>
              <dt className="text-muted-foreground">Documents</dt>
              <dd className="truncate text-right">{t.process_type === "client_supplied" ? "We send them" : "Ontriq collects"}</dd>
              {t.defaults.position_title ? (
                <>
                  <dt className="text-muted-foreground">Position</dt>
                  <dd className="truncate text-right">{t.defaults.position_title}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Used</dt>
              <dd className="text-right tabular-nums">
                {t.usage_count}× {t.last_used_at ? <span className="text-muted-foreground">· {formatDate(t.last_used_at)}</span> : null}
              </dd>
            </dl>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              {canRequest && t.is_active && pkg?.is_active ? (
                <Link href={`/portal/cases/new?template=${t.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Use in a request <ArrowRight className="size-3.5" />
                </Link>
              ) : (
                <span />
              )}
              {manage ? (
                <div className="flex items-center gap-0.5">
                  <TemplateFlags template={t} />
                  <TemplateButton packages={usable} editing={t} />
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
