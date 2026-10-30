"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { STAFF_NAV, visibleNav } from "./nav";

/** Active items get the website's orange indicator and a lit icon. */
export const NAV_ITEM_CLASS =
  "relative h-9 gap-2.5 rounded-lg px-2.5 text-[13.5px] text-sidebar-foreground/80 hover:bg-white/[0.06] hover:text-white data-active:bg-white/[0.09] data-active:font-medium data-active:text-white data-active:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] data-active:[&_svg]:text-brand-orange before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-orange before:opacity-0 before:transition-opacity data-active:before:opacity-100 group-data-[collapsible=icon]:before:hidden";

export const NAV_LABEL_CLASS = "text-[10.5px] font-semibold tracking-[0.2em] text-sidebar-foreground/40 uppercase";

export function SidebarNav({ viewer }: { viewer: { permissions: string[]; roleKey: string } }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const sections = visibleNav(STAFF_NAV, viewer);
  const matches = (href: string) => (href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`));
  // The most specific item wins, so /app/team/performance lights Performance, not Team as well.
  const current = sections.flatMap((s) => s.items.map((i) => i.href)).filter(matches).sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === current;

  return (
    <>
      {sections.map((section) => (
        <SidebarGroup key={section.label}>
          <SidebarGroupLabel className={NAV_LABEL_CLASS}>{section.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {section.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title} className={NAV_ITEM_CLASS}>
                    <Link href={item.href} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
