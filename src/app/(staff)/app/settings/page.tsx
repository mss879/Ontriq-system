import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Building2, CheckCircle2, CircleDashed, PlugZap, ShieldCheck, type LucideIcon } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createRequestClient } from "@/lib/supabase/server";
import { getStaffViewer } from "@/lib/server/viewer";
import { integrationStatus } from "@/lib/env";
import { can } from "@/domain/permissions";
import { readBranding } from "@/domain/branding";
import { BrandingForm } from "./branding-form";
import { MfaPolicySwitch } from "./security-card";
import { SETTINGS_NAV, canSeeNavItem } from "@/components/layout/nav";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Page className="max-w-4xl">
      <PageHeader eyebrow="Administration" title="Settings" description="Organisation details, security and connected services." />
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Organisation />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <Security />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <Integrations />
      </Suspense>
    </Page>
  );
}

async function Organisation() {
  const viewer = await getStaffViewer();
  // People who manage only part of settings land on the first area they may use.
  if (!can(viewer, "settings.manage")) redirect(SETTINGS_NAV.find((item) => item.href !== "/app/settings" && canSeeNavItem(item, viewer))?.href ?? "/app");
  const supabase = await createRequestClient();
  const { data: org } = await supabase.from("orgs").select("branding").eq("id", viewer.orgId).single();
  return (
    <Card>
      <CardHeader className="border-b">
        <SectionHeading icon={Building2} title="Organisation and branding" description="Printed on quotations, invoices, reports and emails." />
      </CardHeader>
      <CardContent>
        <BrandingForm branding={readBranding(org?.branding)} canEdit={can(viewer, "settings.manage")} />
      </CardContent>
    </Card>
  );
}

async function Security() {
  const viewer = await getStaffViewer();
  const supabase = await createRequestClient();
  const { data: org } = await supabase.from("orgs").select("mfa_required_for_staff").eq("id", viewer.orgId).single();
  return (
    <Card>
      <CardHeader className="border-b">
        <SectionHeading icon={ShieldCheck} title="Security" description="Staff accounts can open candidate documents, so a second factor is strongly recommended." />
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-6 rounded-xl bg-muted/40 p-4 ring-1 ring-foreground/[0.05]">
          <div className="space-y-1">
            <p className="text-sm font-medium">Require two-step verification for staff</p>
            <p className="text-sm text-muted-foreground">
              Staff without a verified authenticator can’t see any data. {viewer.roleKey !== "super_admin" ? "Only a Super Admin can change this." : null}
            </p>
          </div>
          <MfaPolicySwitch required={org?.mfa_required_for_staff ?? true} canEdit={viewer.roleKey === "super_admin"} />
        </div>
      </CardContent>
    </Card>
  );
}

async function Integrations() {
  await getStaffViewer();
  await connection();
  const items = integrationStatus();
  return (
    <Card id="integrations">
      <CardHeader className="border-b">
        <SectionHeading
          icon={PlugZap}
          title="Connected services"
          description="Keys live in the hosting environment (Netlify), never in the database. Values are never shown here."
          aside={
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {items.filter((i) => i.configured).length} of {items.length} connected
            </span>
          }
        />
      </CardHeader>
      <CardContent className="divide-y">
        {items.map((item) => (
          <div key={item.key} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
            {item.configured ? <CheckCircle2 className="mt-0.5 size-[18px] text-success" /> : <CircleDashed className="mt-0.5 size-[18px] text-muted-foreground" />}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{item.label}</p>
                {item.configured ? (
                  <Badge className="bg-success/10 text-success ring-1 ring-success/20">Connected</Badge>
                ) : item.required ? (
                  <Badge variant="destructive">Required</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Optional</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{item.help}</p>
              <p className="font-mono text-xs text-muted-foreground">{item.envVars.join(" · ")}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SectionHeading({ icon: Icon, title, description, aside }: { icon: LucideIcon; title: string; description: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      {aside}
    </div>
  );
}
