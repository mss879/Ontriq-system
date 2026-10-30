"use client";

import { useEffect } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/**
 * Light is the product's default. Dark is a choice each person makes with the
 * theme toggle, kept in their browser. The operating system's setting is
 * deliberately ignored.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" themes={["light", "dark"]} disableTransitionOnChange>
      <ThemeMigration />
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}

/** Browsers that stored the old "system" option move to light. A stored dark choice is kept. */
function ThemeMigration() {
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    if (theme === "system") setTheme("light");
  }, [theme, setTheme]);
  return null;
}
