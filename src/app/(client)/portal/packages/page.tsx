import { Suspense } from "react";
import type { Metadata } from "next";
import { Boxes, Clock, Hourglass } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ToneChip } from "@/components/cases/badges";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getClientViewer } from "@/lib/server/viewer";
import { portalPackages, portalPriceList, portalSettings, type PortalPackage } from "@/lib/server/portal/queries";
import { formatMoney } from "@/lib/format";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";
import { PackageActiveToggle, PackageBuilderButton } from "./package-builder";

export const metadata: Metadata = { title: "Packages" };

const DESCRIPTION = "The checks in each package and what they cost. Build your own packages for the roles you hire most.";

export default function PackagesPage() {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Catalogue" title="Packages" description={DESCRIPTION} />}>
        <Header />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </Page>
  );
}

async function canBuild() {
  const viewer = await getClientViewer();
  const settings = await portalSettings(viewer.clientId ?? "");
  return { viewer, settings, build: can(viewer, "portal.packages.manage") && settings.client_packages };
}

async function Header() {
  const { build, settings } = await canBuild();
  const priceList = build ? await portalPriceList() : [];
  return (
    <PageHeader
      eyebrow="Catalogue"
      title="Packages"
      description={DESCRIPTION}
      actions={build ? <PackageBuilderButton priceList={priceList} needsApproval={settings.client_packages_need_approval} /> : null}
    />
  );
}

async function Content() {
  const { build, settings } = await canBuild();
  const [packages, priceList] = await Promise.all([portalPackages(), build ? portalPriceList() : Promise.resolve([])]);
  const ontriq = packages.filter((p) => p.owner_scope === "org" && p.is_active);
  const own = packages.filter((p) => p.owner_scope === "client");
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Ontriq packages</h2>
        {ontriq.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ontriq.map((p) => (
              <PackageCard key={p.id} pkg={p} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Ontriq hasn&apos;t offered packages to your company yet.</p>
        )}
      </section>
      <section className="space-y-3">
        <div className="space-y-0.5">
          <h2 className="font-display text-lg font-semibold tracking-tight">Your packages</h2>
          <p className="text-sm text-muted-foreground">
            {settings.client_packages ? "Packages your company built. They appear in New request straight away." : "Ask Ontriq to switch on custom packages for your company."}
          </p>
        </div>
        {own.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {own.map((p) => (
              <PackageCard
                key={p.id}
                pkg={p}
                actions={
                  build ? (
                    <div className="flex items-center gap-1">
                      <PackageBuilderButton priceList={priceList} needsApproval={settings.client_packages_need_approval} editing={{ id: p.id, name: p.name, description: p.description, checkTypeIds: p.items.map((i) => i.check_type_id) }} />
                      <PackageActiveToggle id={p.id} active={p.is_active} waiting={p.needs_approval} />
                    </div>
                  ) : null
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Boxes />
                </EmptyMedia>
                <EmptyTitle>No packages of your own yet</EmptyTitle>
                <EmptyDescription>{build ? "Build one for a role you hire often, like “Driver onboarding” or “Senior hire”." : "Your portal admin can build packages for your company."}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </section>
    </div>
  );
}

function PackageCard({ pkg, actions }: { pkg: PortalPackage; actions?: React.ReactNode }) {
  const waiting = pkg.needs_approval;
  return (
    <article className={cn("flex flex-col rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]", !pkg.is_active && "opacity-75")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{pkg.name}</h3>
          {pkg.description ? <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{pkg.description}</p> : null}
        </div>
        {waiting ? (
          <ToneChip tone="warning">
            <Hourglass className="size-3" /> Awaiting approval
          </ToneChip>
        ) : !pkg.is_active ? (
          <ToneChip tone="neutral">Archived</ToneChip>
        ) : null}
      </div>
      <ul className="mt-4 mb-4 space-y-1.5 text-sm">
        {pkg.items.map((i) => (
          <li key={i.check_type_id} className="flex items-baseline justify-between gap-3">
            <span className="truncate text-muted-foreground">{i.name}</span>
            {pkg.pricing_mode === "sum" ? <span className="shrink-0 tabular-nums">{i.unit_price > 0 ? formatMoney(i.unit_price, pkg.currency) : "—"}</span> : null}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-end justify-between gap-3 border-t pt-3">
        <div>
          <p className="font-display text-xl font-semibold tabular-nums">{pkg.total > 0 ? formatMoney(pkg.total, pkg.currency) : "Price on quote"}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" /> {pkg.tat_days} working days
          </p>
        </div>
        {actions}
      </div>
      {waiting ? <p className="mt-3 text-xs text-muted-foreground">Ontriq will approve this package before it can be used on requests.</p> : null}
    </article>
  );
}
