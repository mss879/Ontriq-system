import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getStaffViewer } from "@/lib/server/viewer";
import { allTaxRates } from "@/lib/server/billing/queries";
import { REMINDER_STEPS } from "@/domain/pricing/invoice-core";
import { can } from "@/domain/permissions";
import { TaxRatesForm } from "./tax-rates-form";

export const metadata: Metadata = { title: "Billing & taxes" };

export default function BillingSettingsPage() {
  return (
    <Page>
      <PageHeader eyebrow="Administration" title="Billing & taxes" description="Taxes on new invoices, and how overdue invoices are followed up." />
      <Alert>
        <Info />
        <AlertTitle>Confirm how VAT and SSCL apply before switching them on</AlertTitle>
        <AlertDescription>Taxes are frozen on an invoice when it is confirmed, so a change here only affects invoices confirmed afterwards.</AlertDescription>
      </Alert>
      <Suspense fallback={<SectionSkeleton rows={4} />}>
        <Taxes />
      </Suspense>
      <Surface>
        <SurfaceHeader title="Payment reminders" description="Sent automatically to the invoice contact and the client's portal users while an invoice is unpaid." />
        <ul className="divide-y text-sm">
          {REMINDER_STEPS.map((s) => (
            <li key={s.step} className="flex items-center justify-between gap-3 px-5 py-3">
              <span>{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.step === "escalated" ? "Alert to staff who send invoices" : "Email to the client"}</span>
            </li>
          ))}
        </ul>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Payment terms are set per client. Reminders can be paused on any invoice, and pause while a client&apos;s payment slip waits to be matched.
        </p>
      </Surface>
    </Page>
  );
}

async function Taxes() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "settings.manage")) redirect("/app");
  const rates = await allTaxRates();
  return <TaxRatesForm rates={rates} />;
}
