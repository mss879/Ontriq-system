import { Suspense } from "react";
import { AppFrame } from "@/components/layout/app-frame";
import { AREA_LABELS } from "@/components/layout/nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { AssistantPanel, CommandPalette, KeyboardShortcuts } from "@/components/layout/lazy-overlays";
import { UserMenu } from "@/components/layout/user-menu";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";
import { getStaffViewer } from "@/lib/server/viewer";
import { latestNotifications } from "@/lib/server/admin/notifications";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { AssistantTrigger } from "@/components/assistant/assistant-trigger";
import { can } from "@/domain/permissions";
import { sttConfigured } from "@/lib/stt/provider";

export default function StaffLayout({ children }: LayoutProps<"/app">) {
  return (
    <AppFrame
      homeHref="/app"
      areaLabel={
        <Suspense fallback="Operations">
          <StaffArea />
        </Suspense>
      }
      nav={
        <Suspense fallback={<NavSkeleton />}>
          <StaffNav />
        </Suspense>
      }
      footer={
        <Suspense fallback={<SidebarMenuSkeleton showIcon />}>
          <StaffUser />
        </Suspense>
      }
      headerEnd={
        <>
          <Suspense fallback={null}>
            <StaffAssistantTrigger />
          </Suspense>
          <Suspense fallback={<div className="size-7" />}>
            <StaffNotifications />
          </Suspense>
        </>
      }
      overlays={
        <>
          <Suspense fallback={null}>
            <StaffPalette />
          </Suspense>
          <Suspense fallback={null}>
            <StaffAssistant />
          </Suspense>
        </>
      }
    >
      {children}
    </AppFrame>
  );
}

async function StaffArea() {
  const viewer = await getStaffViewer();
  return AREA_LABELS[viewer.roleKey] ?? "Operations";
}

async function StaffNav() {
  const viewer = await getStaffViewer();
  return <SidebarNav viewer={{ permissions: viewer.permissions, roleKey: viewer.roleKey }} />;
}

async function StaffPalette() {
  const viewer = await getStaffViewer();
  return (
    <>
      <CommandPalette viewer={{ permissions: viewer.permissions, roleKey: viewer.roleKey }} />
      <KeyboardShortcuts permissions={viewer.permissions} />
    </>
  );
}

async function StaffAssistant() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "ai.assistant")) return null;
  const isSuperAdmin = viewer.permissions.includes("*");
  return <AssistantPanel isSuperAdmin={isSuperAdmin} canRecord={isSuperAdmin && sttConfigured()} />;
}

async function StaffAssistantTrigger() {
  const viewer = await getStaffViewer();
  return can(viewer, "ai.assistant") ? <AssistantTrigger /> : null;
}

async function StaffNotifications() {
  const viewer = await getStaffViewer();
  const { items, unread } = await latestNotifications(20);
  return <NotificationBell userId={viewer.userId} items={items} unread={unread} />;
}

async function StaffUser() {
  const viewer = await getStaffViewer();
  return <UserMenu viewer={{ userId: viewer.userId, fullName: viewer.fullName, email: viewer.email, roleName: viewer.roleName, aal: viewer.aal }} />;
}

function NavSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {["72%", "58%", "80%", "64%"].map((width) => (
        <SidebarMenuSkeleton key={width} showIcon width={width} />
      ))}
    </div>
  );
}
