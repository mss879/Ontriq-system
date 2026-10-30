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
      className="group flex h-9 w-full max-w-sm items-center gap-2.5 rounded-xl border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/15 hover:bg-muted/70 hover:text-foreground md:w-80"
    >
      <Search className="size-4 transition-colors group-hover:text-brand-orange" />
      <span className="flex-1 truncate text-left">Search or jump to…</span>
      <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
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
