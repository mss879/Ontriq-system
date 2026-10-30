"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { allowedShortcuts, matchKey, type Shortcut } from "@/domain/shortcuts";
import { useCommand } from "./command-context";

const SEQUENCE_MS = 1200;

/** True while the person is typing somewhere, or a dialog has focus. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  if (el.isContentEditable) return true;
  if (el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox']")) return true;
  return Boolean(el.closest("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']"));
}

/** Workspace shortcuts: "c" new case, "/" search, "g" then a letter to jump, "?" for the list. */
export function KeyboardShortcuts({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const { setOpen } = useCommand();
  const [help, setHelp] = useState(false);
  const shortcuts = useMemo(() => allowedShortcuts(permissions), [permissions]);
  const pending = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || typing(event.target)) return;
      if (event.key.length !== 1) return;
      const { match, pending: next } = matchKey(shortcuts, pending.current, event.key.toLowerCase());
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      if (next.length) timer.current = setTimeout(() => (pending.current = []), SEQUENCE_MS);
      if (!match) return;
      event.preventDefault();
      run(match);
    }
    function run(s: Shortcut) {
      if (s.action === "palette") setOpen(true);
      else if (s.action === "help") setHelp(true);
      else if (s.href) router.push(s.href as Parameters<typeof router.push>[0]);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, setOpen, shortcuts]);

  const groups = (["Actions", "Go to", "Help"] as const).map((g) => ({ g, items: shortcuts.filter((s) => s.group === g) })).filter((x) => x.items.length);

  return (
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>They work anywhere in the workspace except while you are typing. ⌘K or Ctrl+K opens search; ⌘J or Ctrl+J opens Ask Ontriq.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groups.map(({ g, items }) => (
            <section key={g}>
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{g}</h3>
              <ul className="divide-y rounded-xl ring-1 ring-border">
                {items.map((s) => (
                  <li key={s.keys.join(" ")} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{s.label}</span>
                    <KbdGroup>
                      {s.keys.map((k, i) => (
                        <Kbd key={i}>{k.toUpperCase()}</Kbd>
                      ))}
                    </KbdGroup>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
