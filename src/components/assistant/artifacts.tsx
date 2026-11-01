"use client";

import { useMemo, useState } from "react";
import Link from "@/components/link";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronsUpDown } from "lucide-react";
import type { Artifact } from "@/lib/ai/assistant/types";
import { cn } from "@/lib/utils";
import { safeHref } from "./markdown";
import { sortRows } from "./sort";

type Table = Extract<Artifact, { type: "table" }>;
type Cards = Extract<Artifact, { type: "cards" }>;
type Metrics = Extract<Artifact, { type: "metrics" }>;

const SHOWN = 12;

function Frame({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  const link = href ? safeHref(href) : null;
  return (
    <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/[0.08]">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
        {link && (
          <Link href={link} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline">
            Open in app <ArrowUpRight className="size-3" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

export function TableArtifact({ artifact }: { artifact: Table }) {
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => (sort ? sortRows(artifact.rows, sort.col, sort.dir) : artifact.rows), [artifact.rows, sort]);
  const visible = all ? rows : rows.slice(0, SHOWN);
  if (!artifact.rows.length) {
    return (
      <Frame title={artifact.title} href={artifact.href}>
        <p className="px-3 py-4 text-xs text-muted-foreground">Nothing to show.</p>
      </Frame>
    );
  }
  return (
    <Frame title={artifact.title} href={artifact.href}>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr>
              {artifact.columns.map((c, i) => {
                const active = sort?.col === i;
                return (
                  <th key={c} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => setSort(active && sort!.dir === "asc" ? { col: i, dir: "desc" } : active ? null : { col: i, dir: "asc" })}
                    >
                      {c}
                      {active ? sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((r, i) => (
              <tr key={i} className="hover:bg-muted/40">
                {r.map((cell, j) => (
                  <td key={j} className={cn("px-3 py-1.5 align-top", j === 0 ? "font-medium whitespace-nowrap" : "text-foreground/90", typeof cell === "number" && "tabular-nums")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted/40">
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </Frame>
  );
}

export function CardsArtifact({ artifact }: { artifact: Cards }) {
  return (
    <Frame title={artifact.title}>
      <ul className="divide-y">
        {artifact.items.map((it, i) => {
          const href = it.href ? safeHref(it.href) : null;
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{it.title}</span>
                {it.subtitle && <span className="block truncate text-xs text-muted-foreground">{it.subtitle}</span>}
              </span>
              {it.meta && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground capitalize">{it.meta.replace(/_/g, " ")}</span>}
              {href && <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />}
            </>
          );
          return (
            <li key={i}>
              {href ? (
                <Link href={href} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}

export function MetricsArtifact({ artifact }: { artifact: Metrics }) {
  return (
    <Frame title={artifact.title}>
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
        {artifact.items.map((m) => (
          <div key={m.label} className="bg-card px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
            <dd className="truncate text-sm font-semibold tabular-nums capitalize">{m.value}</dd>
          </div>
        ))}
      </dl>
    </Frame>
  );
}
