"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Briefcase, CornerDownLeft, FilePlus2, FolderOpen, LogOut, Moon, Sun, UserPlus, UserRound } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { LogoMark } from "@/components/brand/logo";
import { Kbd } from "@/components/ui/kbd";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { STAFF_NAV, visibleNav } from "@/components/layout/nav";
import { useCommand } from "./command-context";
import { paletteFilter } from "./palette-filter";
import { signOutNow } from "@/lib/client/sign-out";

type Hit = { kind: "case" | "candidate" | "client"; id: string; title: string; subtitle: string; href: string };

const HIT_GROUPS: { kind: Hit["kind"]; heading: string; icon: typeof FolderOpen }[] = [
  { kind: "case", heading: "Cases", icon: FolderOpen },
  { kind: "candidate", heading: "Candidates", icon: UserRound },
  { kind: "client", heading: "Clients", icon: Briefcase },
];

/** Live record search through /api/search (row level security filters the results). */
function useRecordSearch(query: string) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const id = ++seq.current;
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const body = (await res.json()) as { hits?: Hit[] };
        if (id === seq.current) setHits(body.hits ?? []);
      } catch {
        if (id === seq.current) setHits([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  return { hits: query.trim().length < 2 ? [] : hits, loading: query.trim().length >= 2 && loading };
}

/** ⌘K palette: pages, actions and live search across cases, candidates and clients. */
export function CommandPalette({ viewer }: { viewer: { permissions: string[]; roleKey: string } }) {
  const { open, setOpen } = useCommand();
  const router = useRouter();
  const { setTheme } = useTheme();
  const sections = visibleNav(STAFF_NAV, viewer);
  const has = (p: string) => viewer.permissions.includes("*") || viewer.permissions.includes(p);
  const canInvite = has("users.manage");
  const canCreateCase = has("cases.create");
  const [query, setQuery] = useState("");
  const { hits, loading } = useRecordSearch(query);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      title="Command palette" description="Search pages and actions" className="rounded-2xl! shadow-lift sm:max-w-xl">
      <Command filter={paletteFilter}>
      <CommandInput placeholder="Search cases, candidates, clients or pages…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{loading ? "Searching…" : "Nothing found."}</CommandEmpty>
        {HIT_GROUPS.map((group) => {
          const items = hits.filter((h) => h.kind === group.kind);
          if (!items.length) return null;
          return (
            <CommandGroup key={group.kind} heading={group.heading}>
              {items.map((hit) => (
                <CommandItem
                  key={`${hit.kind}:${hit.id}`}
                  value={`${hit.kind} ${hit.title} ${hit.id}`}
                  keywords={[query]}
                  onSelect={() => run(() => router.push(hit.href))}
                >
                  <group.icon />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{hit.title}</span>
                    {hit.subtitle ? <span className="text-muted-foreground"> · {hit.subtitle}</span> : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {loading && !hits.length ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" /> Searching records…
          </div>
        ) : null}
        {sections.map((section) => (
          <CommandGroup key={section.label} heading={section.label}>
            {section.items.map((item) => (
              <CommandItem
                key={item.href}
                value={item.title}
                keywords={item.keywords}
                onSelect={() => run(() => router.push(item.href))}
              >
                <item.icon />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {canCreateCase ? (
            <CommandItem value="New case" keywords={["create", "verification", "request", "add"]} onSelect={() => run(() => router.push("/app/cases/new"))}>
              <FilePlus2 />
              New case
            </CommandItem>
          ) : null}
          {canInvite ? (
            <CommandItem value="Invite a team member" keywords={["staff", "user", "add"]} onSelect={() => run(() => router.push("/app/team?invite=1"))}>
              <UserPlus />
              Invite a team member
            </CommandItem>
          ) : null}
          <CommandItem value="Light theme" keywords={["appearance"]} onSelect={() => run(() => setTheme("light"))}>
            <Sun /> Light theme
          </CommandItem>
          <CommandItem value="Dark theme" keywords={["appearance", "night"]} onSelect={() => run(() => setTheme("dark"))}>
            <Moon /> Dark theme
          </CommandItem>
          <CommandItem
            value="Sign out"
            keywords={["log out", "logout"]}
            onSelect={() =>
              run(async () => {
                signOutNow();
              })
            }
          >
            <LogOut /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex items-center gap-3 border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <LogoMark className="h-3.5" />
        <span className="flex-1">Ontriq search</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>
            <CornerDownLeft className="size-3" />
          </Kbd>{" "}
          to open
        </span>
      </div>
      </Command>
    </CommandDialog>
  );
}
