import { Suspense } from "react";
import Link from "@/components/link";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { CommandProvider } from "@/components/command/command-context";
import { CommandTrigger } from "@/components/command/command-trigger";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { CrumbsProvider, TopbarCrumbs } from "./crumbs";
import { SidebarStateSync } from "./sidebar-state-sync";
import { ThemeToggle } from "./theme-toggle";

/**
 * Static application chrome: a navy brand frame (the website's dark sections)
 * holding the workspace on a rounded panel. Everything that depends on the
 * signed-in user arrives through the `nav` and `footer` slots, each behind its
 * own Suspense boundary, so this frame prerenders into the static shell.
 */
export function AppFrame({
  homeHref,
  areaLabel,
  nav,
  footer,
  headerEnd,
  overlays,
  children,
}: {
  homeHref: string;
  areaLabel: React.ReactNode;
  nav: React.ReactNode;
  footer: React.ReactNode;
  headerEnd?: React.ReactNode;
  /** Mounted outside the sidebar (which is a sheet on phones), e.g. the command palette. */
  overlays?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <CommandProvider>
      <CrumbsProvider>
      <SidebarProvider>
        <SidebarStateSync />
        <Sidebar collapsible="icon" variant="inset" className="text-sidebar-foreground">
          <SidebarHeader className="relative pt-3">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -left-16 size-56 rounded-full bg-[radial-gradient(circle,oklch(0.67_0.2_38/0.22),transparent_65%)] group-data-[collapsible=icon]:hidden"
            />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild tooltip="Ontriq" className="hover:bg-transparent active:bg-transparent">
                  <Link href={homeHref}>
                    <LogoMark tile />
                    <span className="flex min-w-0 flex-col gap-1.5 leading-none">
                      <Wordmark reversed className="h-[13px]! w-auto! text-white" />
                      <span className="text-[11px] font-medium tracking-wide text-sidebar-foreground/60">{areaLabel}</span>
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent className="pt-2">{nav}</SidebarContent>
          <SidebarFooter className="pb-3">{footer}</SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="md:peer-data-[variant=inset]:h-[calc(100svh-1rem)] md:peer-data-[variant=inset]:overflow-y-auto md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-[0_0_0_1px_rgb(0_0_0/0.04),0_10px_40px_-12px_rgb(0_0_0/0.45)] dark:md:peer-data-[variant=inset]:shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_10px_40px_-12px_rgb(0_0_0/0.6)]">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65 md:px-5">
            <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            <Suspense fallback={<div className="min-w-0 flex-1" />}>
              <TopbarCrumbs />
            </Suspense>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <CommandTrigger />
              {headerEnd}
              <ThemeToggle />
            </div>
          </header>
          <div className="flex flex-1 flex-col">{children}</div>
        </SidebarInset>
        {overlays}
      </SidebarProvider>
      </CrumbsProvider>
    </CommandProvider>
  );
}
