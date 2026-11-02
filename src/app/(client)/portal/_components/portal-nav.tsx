"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Boxes, FilePlus2, FileSignature, FileText, FolderOpen, LayoutDashboard, LayoutTemplate, Menu, Receipt, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LogoMark } from "@/components/brand/logo";

export type PortalNavKey = "dashboard" | "cases" | "new" | "packages" | "templates" | "reports" | "quotes" | "invoices" | "team" | "settings";

const ITEMS: Record<PortalNavKey, { href: string; label: string; icon: typeof FolderOpen }> = {
  dashboard: { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  cases: { href: "/portal/cases", label: "Cases", icon: FolderOpen },
  new: { href: "/portal/cases/new", label: "New request", icon: FilePlus2 },
  packages: { href: "/portal/packages", label: "Packages", icon: Boxes },
  templates: { href: "/portal/templates", label: "Templates", icon: LayoutTemplate },
  reports: { href: "/portal/reports", label: "Reports", icon: FileText },
  quotes: { href: "/portal/quotes", label: "Quotes", icon: FileSignature },
  invoices: { href: "/portal/invoices", label: "Invoices", icon: Receipt },
  team: { href: "/portal/team", label: "Team", icon: Users },
  settings: { href: "/portal/settings", label: "Settings", icon: Settings },
};

/** Which item a path belongs to: the longest matching href wins, so /portal/cases/new is "New request", not "Cases". */
function activeKey(path: string, keys: PortalNavKey[]): PortalNavKey | null {
  let best: PortalNavKey | null = null;
  let len = -1;
  for (const k of keys) {
    const href = ITEMS[k].href;
    const hit = href === "/portal" ? path === "/portal" : path === href || path.startsWith(`${href}/`);
    if (hit && href.length > len) {
      best = k;
      len = href.length;
    }
  }
  return best;
}

/** Desktop: a tab row under the header. */
export function PortalTabs({ keys }: { keys: PortalNavKey[] }) {
  const path = usePathname();
  const active = activeKey(path, keys);
  return (
    <nav aria-label="Portal" className="-mb-px flex gap-1 overflow-x-auto">
      {keys.map((k) => {
        const item = ITEMS[k];
        const Icon = item.icon;
        const on = active === k;
        return (
          <Link
            key={k}
            href={item.href}
            prefetch="auto"
            aria-current={on ? "page" : undefined}
            data-active={on || undefined}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              on && "border-brand-orange text-foreground",
            )}
          >
            <Icon className={cn("size-4", on ? "text-brand-orange" : "opacity-70")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phones: a menu button that opens the same links in a sheet. */
export function PortalMobileMenu({ keys, clientName, userName }: { keys: PortalNavKey[]; clientName: string; userName: string }) {
  const path = usePathname();
  const active = activeKey(path, keys);
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(20rem,85vw)] gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2.5">
            <LogoMark className="h-6" /> Client portal
          </SheetTitle>
          <SheetDescription className="truncate">
            {clientName} · {userName}
          </SheetDescription>
        </SheetHeader>
        <nav aria-label="Portal" className="flex flex-col gap-0.5 p-2">
          {keys.map((k) => {
            const item = ITEMS[k];
            const Icon = item.icon;
            const on = active === k;
            return (
              <Link
                key={k}
                href={item.href}
                prefetch="auto"
                onClick={() => setOpen(false)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  on && "bg-brand-orange/10 text-foreground",
                )}
              >
                <Icon className={cn("size-[18px]", on ? "text-brand-orange" : "opacity-70")} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t p-4">
          <SignOutButton variant="outline" className="w-full" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

