"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bookmark, BookmarkPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { SavedView } from "@/lib/server/cases/list-queries";
import { deleteView, saveView } from "./actions";
import { FILTER_KEYS, hasFilters } from "./url";

function filterQuery(query: string) {
  const params = new URLSearchParams(query);
  const out = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}

export function SavedViews({ views, query, view }: { views: SavedView[]; query: string; view: "table" | "board" }) {
  const current = filterQuery(query);
  if (!views.length && !hasFilters(query)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Bookmark className="size-3.5" /> Views
      </span>
      {views.map((v) => (
        <ViewChip key={v.id} saved={v} active={filterQuery(v.query) === current} view={view} />
      ))}
      {hasFilters(query) && !views.some((v) => filterQuery(v.query) === current) ? <SaveViewDialog query={current} /> : null}
    </div>
  );
}

function ViewChip({ saved, active, view }: { saved: SavedView; active: boolean; view: "table" | "board" }) {
  const [pending, start] = useTransition();
  const params = new URLSearchParams(saved.query);
  if (view === "board") params.set("view", "board");
  return (
    <span
      className={cn(
        "group inline-flex h-7 items-center gap-1 rounded-full pr-1 pl-3 text-xs font-medium ring-1 transition-colors",
        active ? "bg-primary text-primary-foreground ring-primary" : "bg-card text-foreground ring-border hover:bg-muted",
        !saved.mine && "pr-3",
      )}
    >
      <Link href={`/app/cases?${params.toString()}`} className="inline-flex items-center gap-1.5">
        {saved.shared ? <Users className="size-3 opacity-70" aria-label="Shared with the team" /> : null}
        {saved.name}
      </Link>
      {saved.mine ? (
        <button
          type="button"
          aria-label={`Delete view ${saved.name}`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await deleteView(saved.id);
              if (r.ok) toast.success(`Deleted "${saved.name}"`);
              else toast.error(r.error);
            })
          }
          className={cn("ml-0.5 flex size-5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100", active ? "hover:bg-white/15" : "hover:bg-foreground/10")}
        >
          {pending ? <Spinner className="size-3" /> : <X className="size-3" />}
        </button>
      ) : null}
    </span>
  );
}

function SaveViewDialog({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  const submit = () =>
    start(async () => {
      const r = await saveView(name, query, shared);
      if (r.ok) {
        toast.success(`Saved "${name.trim()}"`);
        setOpen(false);
        setName("");
        setShared(false);
        setError(undefined);
      } else setError(r.error);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 rounded-full text-xs text-muted-foreground">
          <BookmarkPlus /> Save this view
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>Keep these filters one click away.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="view-name">Name</FieldLabel>
            <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Overdue for Hemas" maxLength={60} autoFocus />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </Field>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} />
            Share with the whole team
          </label>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? <Spinner /> : null} Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
