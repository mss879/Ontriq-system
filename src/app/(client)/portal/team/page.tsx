import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { getClientViewer } from "@/lib/server/viewer";
import { portalTeam } from "@/lib/server/portal/queries";
import { createRequestClient } from "@/lib/supabase/server";
import { can } from "@/domain/permissions";
import { InviteButton, TeamList, type RoleOption } from "./team-view";

export const metadata: Metadata = { title: "Team" };

const DESCRIPTION = "Who from your company can use the portal, and what they can do.";

export default function TeamPage() {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Your company" title="Team" description={DESCRIPTION} />}>
        <Header />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <Content />
      </Suspense>
      <Suspense fallback={null}>
        <RoleGuide />
      </Suspense>
    </Page>
  );
}

async function clientRoles(): Promise<RoleOption[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("roles").select("id, key, name, description").eq("kind", "client").order("name");
  // Admin first, then the everyday roles.
  const order = ["client_admin", "client_user", "client_viewer"];
  return (data ?? []).sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99)) as RoleOption[];
}

async function Header() {
  const viewer = await getClientViewer();
  if (!can(viewer, "portal.users.manage")) redirect("/portal");
  const roles = await clientRoles();
  return <PageHeader eyebrow="Your company" title="Team" description={DESCRIPTION} actions={<InviteButton roles={roles} />} />;
}

async function Content() {
  const viewer = await getClientViewer();
  if (!can(viewer, "portal.users.manage")) return null;
  const [members, roles] = await Promise.all([portalTeam(), clientRoles()]);
  return <TeamList members={members} roles={roles} />;
}

async function RoleGuide() {
  const viewer = await getClientViewer();
  if (!can(viewer, "portal.users.manage")) return null;
  const roles = await clientRoles();
  return (
    <section className="grid gap-3 md:grid-cols-3">
      {roles.map((r) => (
        <div key={r.id} className="rounded-2xl bg-muted/40 p-4 ring-1 ring-foreground/[0.05]">
          <p className="text-sm font-semibold">{r.name}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{r.description}</p>
        </div>
      ))}
    </section>
  );
}
