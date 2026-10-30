"use client";

import { useTransition } from "react";
import { Check, Package, Power, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { setClientPackageStatus } from "../actions";
import type { ClientBuiltPackage } from "@/lib/server/admin/portal";
import { formatDate, formatMoney } from "@/lib/format";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Template = { id: string; name: string; packageName: string; processType: string };

/** Packages and templates the client built in their portal. They choose checks; Ontriq's prices apply. */
export function ClientPackagesCard({ packages, templates, canApprove, needsApproval }: { packages: ClientBuiltPackage[]; templates: Template[]; canApprove: boolean; needsApproval: boolean }) {
  const waiting = packages.filter((p) => p.needsApproval && !p.isActive).length;
  return (
    <Surface>
      <SurfaceHeader
        title="Their packages and templates"
        description={
          waiting
            ? `${waiting} ${waiting === 1 ? "package is" : "packages are"} waiting for your approval.`
            : needsApproval
              ? "New packages they build wait for Ontriq's approval before use."
              : "Built by the client in their portal. They choose checks; Ontriq's prices apply."
        }
      />
      {packages.length === 0 && templates.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <Package className="size-4 shrink-0" /> None yet. Portal users with the Client Admin role can build packages and request templates.
        </div>
      ) : (
        <ul className="divide-y">
          {packages.map((p) => (
            <PackageRow key={p.id} p={p} canApprove={canApprove} />
          ))}
          {templates.map((t) => (
            <li key={t.id} className="px-5 py-3.5">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                Template · {t.packageName} · {t.processType}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

function PackageRow({ p, canApprove }: { p: ClientBuiltPackage; canApprove: boolean }) {
  const [pending, start] = useTransition();
  const waiting = p.needsApproval && !p.isActive;
  const run = (action: "approve" | "deactivate" | "reactivate", ok: string) =>
    start(async () => {
      const r = await setClientPackageStatus(p.id, action);
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{p.name}</p>
          <ToneChip tone={waiting ? "warning" : p.isActive ? "success" : "neutral"}>{waiting ? "Waiting for approval" : p.isActive ? "In use" : "Switched off"}</ToneChip>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {p.items.map((i) => (
            <span key={i.checkTypeId} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {i.name}
            </span>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {p.code} · built {formatDate(p.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <span className="text-sm font-medium tabular-nums">{p.total > 0 ? formatMoney(p.total, p.currency) : "Price not set"}</span>
        {canApprove ? (
          waiting ? (
            <Button size="sm" onClick={() => run("approve", `${p.name} approved`)} disabled={pending}>
              {pending ? <Spinner /> : <Check />} Approve
            </Button>
          ) : p.isActive ? (
            <Button size="sm" variant="ghost" onClick={() => run("deactivate", `${p.name} switched off`)} disabled={pending}>
              {pending ? <Spinner /> : <Power />} Switch off
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => run("reactivate", `${p.name} switched on`)} disabled={pending}>
              {pending ? <Spinner /> : <RotateCcw />} Switch on
            </Button>
          )
        ) : null}
      </div>
    </li>
  );
}
