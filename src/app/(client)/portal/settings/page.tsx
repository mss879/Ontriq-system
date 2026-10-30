import { Suspense } from "react";
import type { Metadata } from "next";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getClientViewer } from "@/lib/server/viewer";
import { createRequestClient } from "@/lib/supabase/server";
import { PORTAL_EVENTS } from "./events";
import { EmailPreferences, NameForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Page>
      <PageHeader eyebrow="Your account" title="Settings" description="Your details and how the portal keeps you posted." />
      <Suspense fallback={<SectionSkeleton rows={4} />}>
        <Account />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <Notifications />
      </Suspense>
    </Page>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
      <div className="mb-5 space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

async function Account() {
  const viewer = await getClientViewer();
  return (
    <Card title="Your details" description={`${viewer.roleName} at ${viewer.clientName}. Your name appears on requests you send.`}>
      <NameForm fullName={viewer.fullName} email={viewer.email} />
    </Card>
  );
}

async function Notifications() {
  const viewer = await getClientViewer();
  const supabase = await createRequestClient();
  const { data } = await supabase.from("notification_prefs").select("matrix").eq("user_id", viewer.userId).maybeSingle();
  const matrix = (data?.matrix ?? {}) as Record<string, { email?: boolean }>;
  const initial = Object.fromEntries(PORTAL_EVENTS.map((e) => [e.type, matrix[e.type]?.email ?? true]));
  return (
    <Card title="Email notifications" description="Every update appears under the bell in the portal. Choose which ones also come by email.">
      <EmailPreferences initial={initial} />
    </Card>
  );
}
