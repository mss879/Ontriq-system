"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { savePortalOptions, savePortalVisibility } from "../actions";
import type { PortalOptions } from "@/lib/server/admin/portal";
import type { PortalVisibility } from "@/domain/portal/types";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

type BoolKey = Exclude<keyof PortalVisibility, "hidden_check_types">;

const SEE: { key: BoolKey; label: string; hint: string }[] = [
  { key: "show_check_progress", label: "Progress of each check", hint: "Not started, in progress, completed." },
  { key: "show_timeline", label: "Case timeline", hint: "Client-safe events only, never internal notes or QC remarks." },
  { key: "show_documents", label: "Shared documents", hint: "Files you mark “Client can see”, and their own uploads. Report evidence stays in the released PDF." },
  { key: "show_candidate_progress", label: "Candidate progress", hint: "Whether the candidate opened their link and signed consent." },
  { key: "show_candidate_details", label: "Candidate personal details", hint: "NIC, email and phone. Off by default: they see the candidate's name only." },
  { key: "show_results_before_release", label: "Results before release", hint: "Off by default: results appear once the report is released." },
];

const DO: { key: keyof PortalOptions; label: string; hint: string }[] = [
  { key: "status_updates", label: "Get status updates", hint: "An email and portal alert when a case changes stage or goes on hold." },
  { key: "bulk_upload", label: "Bulk requests", hint: "Submit many candidates at once from a spreadsheet." },
  { key: "client_packages", label: "Build their own packages", hint: "From the checks they may order, at Ontriq's prices." },
  { key: "client_packages_need_approval", label: "Approve their packages first", hint: "New packages wait for Ontriq before they can be used." },
];

/** What the client's portal shows and allows. Applied in the database by the portal functions (0021). */
export function PortalSettingsCard({
  clientId,
  visibility,
  options,
  checkTypes,
  canEdit,
}: {
  clientId: string;
  visibility: PortalVisibility;
  options: PortalOptions;
  checkTypes: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [, start] = useTransition();
  const [vis, setVis] = useOptimistic(visibility, (state, change: Partial<PortalVisibility>) => ({ ...state, ...change }));
  const [opts, setOpts] = useOptimistic(options, (state, change: Partial<PortalOptions>) => ({ ...state, ...change }));

  const saveVis = (change: Partial<PortalVisibility>, ok: string) =>
    start(async () => {
      setVis(change);
      const r = await savePortalVisibility(clientId, change);
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });
  const saveOpts = (change: Partial<PortalOptions>, ok: string) =>
    start(async () => {
      setOpts(change);
      const r = await savePortalOptions(clientId, change);
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });

  const hidden = new Set(vis.hidden_check_types);

  return (
    <Surface>
      <SurfaceHeader title="Client portal" description="What this client sees and can do. Internal notes, QC remarks and assignees are never shown." />
      <div className="divide-y">
        <Group title="They can see">
          {SEE.map((item) => (
            <ToggleRow
              key={item.key}
              id={`vis-${item.key}`}
              label={item.label}
              hint={item.hint}
              checked={vis[item.key]}
              disabled={!canEdit}
              onChange={(checked) => saveVis({ [item.key]: checked }, `${item.label} ${checked ? "shown" : "hidden"} in their portal`)}
            />
          ))}
        </Group>
        {vis.show_check_progress && checkTypes.length ? (
          <Group title="Checks shown in their portal">
            <ul className="grid gap-x-4 gap-y-2 px-5 pb-3 sm:grid-cols-2 lg:grid-cols-1">
              {checkTypes.map((t) => {
                const id = `hide-${t.id}`;
                return (
                  <li key={t.id}>
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <Checkbox
                        id={id}
                        checked={!hidden.has(t.id)}
                        disabled={!canEdit}
                        onCheckedChange={(c) => {
                          const next = new Set(hidden);
                          if (c) next.delete(t.id);
                          else next.add(t.id);
                          saveVis({ hidden_check_types: [...next] }, `${t.name} ${c ? "shown" : "hidden"} in their portal`);
                        }}
                      />
                      {t.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Group>
        ) : null}
        <Group title="They can">
          {DO.map((item) => (
            <ToggleRow
              key={item.key}
              id={`opt-${item.key}`}
              label={item.label}
              hint={item.hint}
              checked={opts[item.key]}
              disabled={!canEdit || (item.key === "client_packages_need_approval" && !opts.client_packages)}
              onChange={(checked) => saveOpts({ [item.key]: checked }, `${item.label}: ${checked ? "on" : "off"}`)}
            />
          ))}
        </Group>
      </div>
    </Surface>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-3">
      <p className="px-5 pb-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  );
}

function ToggleRow({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
