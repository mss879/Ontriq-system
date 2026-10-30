"use client";

import { ChevronsUpDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { hardNavigate } from "@/lib/client/hard-navigate";

export function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function UserMenu({ viewer }: { viewer: { fullName: string; email: string; roleName: string; aal: string } }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="rounded-xl bg-white/[0.04] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] hover:bg-white/[0.08] data-[state=open]:bg-white/[0.08] group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-[linear-gradient(135deg,#f78f1e,#f75834_45%,#0c5a9a)] text-xs font-semibold text-white">
                  {initials(viewer.fullName, viewer.email)}
                </AvatarFallback>
              </Avatar>
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
              <UserRound /> Profile (coming soon)
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <ShieldCheck className={viewer.aal === "aal2" ? "text-success" : undefined} />
              {viewer.aal === "aal2" ? "Two-step verification on" : "Two-step verification off"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await signOut();
                hardNavigate("/login");
              }}
            >
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
