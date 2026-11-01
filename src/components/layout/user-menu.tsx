"use client";

import { ChevronsUpDown, LogOut, ShieldCheck } from "lucide-react";
import { PersonAvatar } from "@/components/cases/person";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { signOutNow } from "@/lib/client/sign-out";

export function UserMenu({ viewer }: { viewer: { userId: string; fullName: string; email: string; roleName: string; aal: string } }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="rounded-xl bg-white/[0.04] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] hover:bg-white/[0.08] data-[state=open]:bg-white/[0.08] group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
            >
              <PersonAvatar id={viewer.userId} name={viewer.fullName || viewer.email} />
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium text-white">{viewer.fullName || viewer.email}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">{viewer.roleName}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-(--radix-dropdown-menu-trigger-width) min-w-60">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{viewer.fullName || "Your account"}</span>
              <span className="block truncate text-xs text-muted-foreground">{viewer.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <ShieldCheck className={viewer.aal === "aal2" ? "text-success" : undefined} />
              {viewer.aal === "aal2" ? "Two-step verification on" : "Two-step verification off"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOutNow}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
