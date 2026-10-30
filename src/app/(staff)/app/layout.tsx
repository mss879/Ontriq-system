import { Suspense } from "react";
import { AppFrame } from "@/components/layout/app-frame";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { CommandPalette } from "@/components/command/command-palette";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";
import { getStaffViewer } from "@/lib/server/viewer";
import { latestNotifications } from "@/lib/server/admin/notifications";
import { NotificationBell } from "@/components/notifications/notification-bell";

export default function StaffLayout({ children }: LayoutProps<"/app">) {
  return (
    <AppFrame
      homeHref="/app"
      areaLabel="Operations"
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
        <Suspense fallback={<div className="size-8" />}>
          <StaffNotifications />
        </Suspense>
      }
      overlays={
        <Suspense fallback={null}>
          <StaffPalette />
        </Suspense>
      }
    >
      {children}
    </AppFrame>
  );
}

async function StaffNav() {
  const viewer = await getStaffViewer();
  return <SidebarNav viewer={{ permissions: viewer.permissions, roleKey: viewer.roleKey }} />;
}

async function StaffPalette() {
  const viewer = await getStaffViewer();
  return <CommandPalette viewer={{ permissions: viewer.permissions, roleKey: viewer.roleKey }} />;
}

async function StaffNotifications() {
  const viewer = await getStaffViewer();
  const { items, unread } = await latestNotifications(20);
  return <NotificationBell userId={viewer.userId} items={items} unread={unread} />;
}

async function StaffUser() {
  const viewer = await getStaffViewer();
  return <UserMenu viewer={{ fullName: viewer.fullName, email: viewer.email, roleName: viewer.roleName, aal: viewer.aal }} />;
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
