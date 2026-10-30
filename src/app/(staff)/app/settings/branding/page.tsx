import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Hash, Landmark, LayoutTemplate } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { createRequestClient } from "@/lib/supabase/server";
import { getStaffViewer } from "@/lib/server/viewer";
import { getIssuer } from "@/lib/server/quotes/queries";
import { can, canAny } from "@/domain/permissions";
import { TEMPLATE_KEYS, type TemplateKey } from "@/domain/documents/model";
import { BankDetailsForm, NumberingSeries, TemplatePicker, type SeriesRow } from "./branding-settings";

export const metadata: Metadata = { title: "Branding & documents" };

const SERIES_LABELS: Record<string, string> = {
  quote: "Quotations",
  invoice: "Invoices",
  credit_note: "Credit notes",
  receipt: "Receipts",
  consent: "Consent forms",
  statement: "Statements",
};

export default function BrandingSettingsPage() {
  return (
    <Page className="max-w-5xl">
      <PageHeader eyebrow="Settings" title="Branding & documents" description="How quotations, invoices, receipts and statements look, the bank details they print, and how they are numbered." />
      <Suspense fallback={<SectionSkeleton rows={4} />}>
        <PrintedDetails />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <Designs />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={4} />}>
        <Bank />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <Numbering />
      </Suspense>
    </Page>
  );
}

async function viewerOrRedirect() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, ["settings.manage", "templates.manage"])) redirect("/app/settings");
  return viewer;
}

async function PrintedDetails() {
  const viewer = await viewerOrRedirect();
  const issuer = await getIssuer(viewer.orgId);
  const rows = [
    ["Name", issuer.legal_name],
    ["Address", issuer.address],
    ["Phone", issuer.phone],
    ["Email", issuer.email],
    ["Website", issuer.website],
    ["Company registration", issuer.registration_no ?? ""],
    ["VAT registration", issuer.vat_no ?? ""],
  ];
  return (
    <Surface>
      <SurfaceHeader
        title={
          <span className="flex items-center gap-2">
            <Building2 className="size-4" /> Printed company details
          </span>
        }
        description="Shown in every document's header and footer."
        aside={
          can(viewer, "settings.manage") ? (
            <Link href="/app/settings" className="text-sm font-medium text-primary hover:underline">
              Edit on Organisation
            </Link>
          ) : null
        }
      />
      <dl className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 sm:block">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={value ? "" : "text-muted-foreground"}>{value || "Not set"}</dd>
          </div>
        ))}
      </dl>
    </Surface>
  );
}

async function Designs() {
  const viewer = await viewerOrRedirect();
  const supabase = await createRequestClient();
  const [issuer, { data: templates }] = await Promise.all([getIssuer(viewer.orgId), supabase.from("document_templates").select("key, is_default")]);
  const def = (templates ?? []).find((t) => t.is_default)?.key;
  const defaultKey = ((TEMPLATE_KEYS as readonly string[]).includes(def ?? "") ? def : "executive") as TemplateKey;
  return (
    <Surface>
      <SurfaceHeader
        title={
          <span className="flex items-center gap-2">
            <LayoutTemplate className="size-4" /> Document designs
          </span>
        }
        description="The preview is drawn from the same layout as the PDF."
      />
      <div className="px-5 py-5">
        <TemplatePicker issuer={issuer} defaultKey={defaultKey} canEdit={can(viewer, "templates.manage")} />
      </div>
    </Surface>
  );
}

async function Bank() {
  const viewer = await viewerOrRedirect();
  const issuer = await getIssuer(viewer.orgId);
  return (
    <Surface>
      <SurfaceHeader
        title={
          <span className="flex items-center gap-2">
            <Landmark className="size-4" /> Bank details
          </span>
        }
        description="Where clients pay by bank transfer."
      />
      <div className="px-5 py-5">
        <BankDetailsForm bank={issuer.bank ?? null} canEdit={can(viewer, "settings.manage")} />
      </div>
    </Surface>
  );
}

async function Numbering() {
  const viewer = await viewerOrRedirect();
  if (!can(viewer, "settings.manage")) return null;
  const supabase = await createRequestClient();
  const { data } = await supabase.from("document_series").select("kind, prefix, padding, yearly_reset").order("kind");
  const order = Object.keys(SERIES_LABELS);
  const rows: SeriesRow[] = (data ?? [])
    .map((r) => ({ ...r, label: SERIES_LABELS[r.kind] ?? r.kind }))
    .sort((a, b) => (order.indexOf(a.kind) + 100) % 100 - (order.indexOf(b.kind) + 100) % 100);
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric" }).format(new Date()));
  return (
    <Surface>
      <SurfaceHeader
        title={
          <span className="flex items-center gap-2">
            <Hash className="size-4" /> Numbering
          </span>
        }
        description="Numbers never repeat or skip; voided documents keep theirs. Changes apply to the next number issued."
      />
      <NumberingSeries rows={rows} canEdit year={year} />
    </Surface>
  );
}
