"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setCheckAccess } from "../actions";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { Switch } from "@/components/ui/switch";

type Item = { id: string; name: string; description: string; enabled: boolean };

/** Which checks this client may order. Turning one off hides it from their packages and blocks new cases with it. */
export function CheckAccessCard({ clientId, types, canEdit }: { clientId: string; types: Item[]; canEdit: boolean }) {
  const [, start] = useTransition();
  const [items, setOptimistic] = useOptimistic(types, (state, change: { id: string; enabled: boolean }) =>
    state.map((t) => (t.id === change.id ? { ...t, enabled: change.enabled } : t)),
  );
  const on = items.filter((t) => t.enabled).length;

  return (
    <Surface>
      <SurfaceHeader title="Checks they may order" description={`${on} of ${items.length} available to this client.`} />
      <ul className="divide-y">
        {items.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-4 px-5 py-3">
            <label htmlFor={`access-${t.id}`} className="min-w-0 cursor-pointer">
              <span className="block text-sm font-medium">{t.name}</span>
              <span className="block text-xs text-muted-foreground">{t.description}</span>
            </label>
            <Switch
              id={`access-${t.id}`}
              aria-label={`${t.name} available to this client`}
              checked={t.enabled}
              disabled={!canEdit}
              onCheckedChange={(enabled) =>
                start(async () => {
                  setOptimistic({ id: t.id, enabled });
                  const r = await setCheckAccess(clientId, t.id, enabled);
                  if (r.ok) toast.success(`${t.name} ${enabled ? "turned on" : "turned off"} for this client`);
                  else toast.error(r.error);
                })
              }
            />
          </li>
        ))}
      </ul>
    </Surface>
  );
}
