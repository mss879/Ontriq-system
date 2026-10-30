"use client";

import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";

/** Puts the sidebar back as the person left it. The frame is prerendered, so this reads the cookie in the browser. */
export function SidebarStateSync() {
  const { setOpen } = useSidebar();
  useEffect(() => {
    if (document.cookie.split("; ").includes("sidebar_state=false")) setOpen(false);
  }, [setOpen]);
  return null;
}
