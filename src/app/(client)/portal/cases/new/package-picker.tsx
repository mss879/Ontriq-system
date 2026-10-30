"use client";

import { Check, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { PortalPackage, PortalTemplate } from "@/lib/server/portal/queries";

export type PackageChoice = { templateId?: string; packageId?: string };

export const PROCESS_LABEL = { client_supplied: "You send the documents", candidate_collected: "Ontriq collects from the candidate" } as const;

export const priceText = (p: PortalPackage) => (p.total > 0 ? formatMoney(p.total, p.currency) : "Price on quote");

/** Templates first (one click fills everything), then every package the company may use. */
export function PackagePicker({ templates, packages, value, onPick }: { templates: PortalTemplate[]; packages: PortalPackage[]; value: PackageChoice; onPick: (p: PackageChoice) => void }) {
  const byId = new Map(packages.map((p) => [p.id, p]));
  return (
    <div className="space-y-5">
      {templates.length ? (
        <div className="space-y-2.5">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Your templates</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => {
              const pkg = byId.get(t.package_id);
              const on = value.templateId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPick({ templateId: t.id, packageId: t.package_id })}
                  aria-pressed={on}
                  className={cn(
                    "group flex min-w-0 flex-col gap-2.5 rounded-2xl bg-card p-4 text-left ring-1 ring-foreground/[0.08] transition hover:-translate-y-px hover:shadow-lift hover:ring-brand-orange/40",
                    on && "ring-2 ring-brand-orange",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                      {t.is_favourite ? <Star className="size-3.5 shrink-0 fill-brand-orange text-brand-orange" aria-label="Favourite" /> : null}
                      <span className="truncate">{t.name}</span>
                    </p>
                    {on ? <Check className="size-4 shrink-0 text-brand-orange" /> : null}
                  </div>
                  {t.description ? <p className="line-clamp-2 text-[13px] text-muted-foreground">{t.description}</p> : null}
                  {pkg ? <CheckChips names={pkg.items.map((i) => i.name)} /> : null}
                  <p className="text-xs text-muted-foreground">
                    {pkg?.name ?? "Package"} · {pkg?.tat_days ?? "—"} working days · {PROCESS_LABEL[t.process_type]}
                    {pkg ? <span className="font-medium text-foreground"> · {priceText(pkg)}</span> : null}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="space-y-2.5">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{templates.length ? "Or choose a package" : "Choose a package"}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => {
            const on = !value.templateId && value.packageId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick({ packageId: p.id })}
                aria-pressed={on}
                className={cn(
                  "flex min-w-0 flex-col gap-2.5 rounded-2xl bg-card p-4 text-left ring-1 ring-foreground/[0.08] transition hover:-translate-y-px hover:shadow-lift hover:ring-brand-orange/40",
                  on && "ring-2 ring-brand-orange",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.owner_scope === "client" ? "Your package" : "Ontriq package"}</p>
                  </div>
                  {on ? <Check className="size-4 shrink-0 text-brand-orange" /> : null}
                </div>
                <CheckChips names={p.items.map((i) => i.name)} />
                <p className="mt-auto text-xs text-muted-foreground">
                  {p.tat_days} working days · <span className="font-medium text-foreground">{priceText(p)}</span>
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CheckChips({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span key={n} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {n}
        </span>
      ))}
    </div>
  );
}
