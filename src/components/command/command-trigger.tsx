"use client";

import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { useCommand } from "./command-context";

export function CommandTrigger() {
  const { setOpen } = useCommand();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Search or jump to"
      className="group flex size-7 items-center justify-center gap-2.5 rounded-lg text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:w-56 md:justify-start md:rounded-xl md:border md:bg-muted/40 md:px-3 md:hover:border-foreground/15 md:hover:bg-muted/70 lg:w-64"
    >
      <Search className="size-4 shrink-0 transition-colors group-hover:text-brand-orange" />
      <span className="hidden flex-1 truncate text-left md:inline">Search or jump to…</span>
      <Kbd className="hidden md:inline-flex">⌘K</Kbd>
    </button>
  );
}

/** A secondary way to open the palette, e.g. from the dashboard hero. */
export function OpenPaletteButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const { setOpen } = useCommand();
  return (
    <button type="button" onClick={() => setOpen(true)} className={className}>
      {children}
    </button>
  );
}
