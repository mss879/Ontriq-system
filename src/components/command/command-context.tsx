"use client";

import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";

type CommandState = { open: boolean; setOpen: (open: boolean) => void; toggle: () => void };
const CommandContext = createContext<CommandState | null>(null);

/** Owns the palette's open state and the ⌘K / Ctrl+K shortcut. */
export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return <CommandContext value={value}>{children}</CommandContext>;
}

export function useCommand() {
  const ctx = use(CommandContext);
  if (!ctx) throw new Error("useCommand must be used inside CommandProvider");
  return ctx;
}
