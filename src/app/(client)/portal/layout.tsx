import { Suspense } from "react";
import Link from "@/components/link";
import { Building2 } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getClientViewer, type Viewer } from "@/lib/server/viewer";
import { latestNotifications } from "@/lib/server/admin/notifications";
import { can } from "@/domain/permissions";
import { PortalMobileMenu, PortalTabs, type PortalNavKey } from "./_components/portal-nav";

/** The portal links a client user may open. */
function navKeys(viewer: Viewer): PortalNavKey[] {
  const keys: PortalNavKey[] = ["dashboard", "cases"];
  if (can(viewer, "portal.cases.create")) keys.push("new");
  keys.push("packages");
  if (can(viewer, "portal.templates.manage") || can(viewer, "portal.cases.create")) keys.push("templates");
  keys.push("reports");
  if (can(viewer, "portal.quotes.accept")) keys.push("quotes");
  if (can(viewer, "portal.invoices.view")) keys.push("invoices");
  if (can(viewer, "portal.users.manage")) keys.push("team");
  keys.push("settings");
  return keys;
}

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <div className="flex min-h-svh flex-col">
      <div aria-hidden className="h-1 brand-gradient-soft" />
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-8">
          <Link href="/portal" className="flex items-center" aria-label="Ontriq client portal home">
            <Logo subtitle="Client portal" className="hidden text-foreground sm:flex" />
            <span className="flex items-center gap-2.5 sm:hidden">
              <LogoMark className="h-7" />
              <span className="text-sm font-semibold">Client portal</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1.5 md:gap-2">
            <Suspense fallback={<div className="size-8" />}>
              <PortalBell />
            </Suspense>
            <Suspense fallback={<div className="hidden h-8 w-40 animate-pulse rounded-lg bg-muted md:block" />}>
              <PortalAccount />
            </Suspense>
            <ThemeToggle />
            <Suspense fallback={<div className="size-8 md:hidden" />}>
              <PortalMenu />
            </Suspense>
          </div>
        </div>
        <div className="mx-auto hidden max-w-6xl px-4 md:block md:px-6">
          <Suspense fallback={<div className="h-11" />}>
            <PortalNav />
          </Suspense>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-center text-xs text-muted-foreground sm:flex-row sm:text-left md:px-8">
          <span className="flex items-center gap-2">
            <LogoMark className="h-4" /> Ontriq (Pvt) Ltd · A Konnect BPO company
          </span>
          <span>Confidential background verification · Reports are released only after approval</span>
        </div>
      </footer>
    </div>
  );
}

async function PortalNav() {
  const viewer = await getClientViewer();
  return <PortalTabs keys={navKeys(viewer)} />;
}

async function PortalMenu() {
  const viewer = await getClientViewer();
  return <PortalMobileMenu keys={navKeys(viewer)} clientName={viewer.clientName ?? ""} userName={viewer.fullName || viewer.email} />;
}

async function PortalBell() {
  const viewer = await getClientViewer();
  const { items, unread } = await latestNotifications(20);
  return <NotificationBell userId={viewer.userId} items={items} unread={unread} />;
}

async function PortalAccount() {
  const viewer = await getClientViewer();
  return (
    <div className="hidden items-center gap-3 md:flex">
      <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 py-1.5 pr-3 pl-1.5 ring-1 ring-foreground/[0.05]">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="size-4" />
        </span>
        <div className="max-w-44 leading-tight">
          <p className="truncate text-[13px] font-semibold">{viewer.clientName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{viewer.fullName || viewer.email}</p>
        </div>
      </div>
      <SignOutButton variant="outline" size="sm" />
    </div>
  );
}
