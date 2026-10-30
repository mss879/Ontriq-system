import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { createRequestClient } from "@/lib/supabase/server";
import { getStaffViewer } from "@/lib/server/viewer";
import { can } from "@/domain/permissions";
import { InviteDialog } from "./invite-dialog";
import { TeamTable, type TeamRow } from "./team-table";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage({ searchParams }: PageProps<"/app/team">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Administration" title="Team" description="People who work in Ontriq and what they can do." />}>
        <TeamHeader searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <TeamList />
      </Suspense>
    </Page>
  );
}

async function staffRoles() {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("roles").select("id, key, name, description").eq("kind", "staff").order("is_system", { ascending: false }).order("name");
  return data ?? [];
}

async function TeamHeader({ searchParams }: Pick<PageProps<"/app/team">, "searchParams">) {
  const [viewer, params, roles] = await Promise.all([getStaffViewer(), searchParams, staffRoles()]);
  if (!can(viewer, "users.manage")) redirect("/app");
  const invitable = roles.filter((r) => r.key !== "super_admin" || viewer.roleKey === "super_admin");
  return (
    <PageHeader
      eyebrow="Administration"
      title="Team"
      description="People who work in Ontriq, their designations and access. Every change is recorded in the audit log."
      actions={<InviteDialog roles={invitable.map(({ id, name, description }) => ({ id, name, description }))} defaultOpen={params.invite === "1"} />}
    />
  );
}

async function TeamList() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "users.manage")) return null;
  const supabase = await createRequestClient();
  const [{ data: memberships }, roles, { data: invitations }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, status, created_at, activated_at, role:roles(id, key, name)")
      .eq("kind", "staff")
      .order("created_at"),
    staffRoles(),
    supabase.from("invitations").select("auth_user_id, last_sent_at, sent_count").eq("status", "pending"),
  ]);

  const userIds = (memberships ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] as { id: string; full_name: string; email: string }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const inviteByUser = new Map((invitations ?? []).map((i) => [i.auth_user_id, i]));
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" });

  const rows: TeamRow[] = (memberships ?? []).map((m) => {
    const role = m.role as { id: string; key: string; name: string } | null;
    const profile = profileById.get(m.user_id);
    const invite = inviteByUser.get(m.user_id);
    return {
      membershipId: m.id,
      userId: m.user_id,
      name: profile?.full_name ?? "",
      email: profile?.email ?? "",
      roleId: role?.id ?? "",
      roleKey: role?.key ?? "",
      roleName: role?.name ?? "—",
      status: m.status,
      since: fmt.format(new Date(m.activated_at ?? m.created_at)),
      inviteNote:
        m.status === "invited" && invite?.last_sent_at
          ? `Sent ${fmt.format(new Date(invite.last_sent_at))}${invite.sent_count > 1 ? ` · ${invite.sent_count}×` : ""}`
          : undefined,
    };
  });

  return (
    <TeamTable
      rows={rows}
      roles={roles.map(({ id, key, name }) => ({ id, key, name }))}
      viewerId={viewer.userId}
      viewerIsSuperAdmin={viewer.roleKey === "super_admin"}
    />
  );
}
