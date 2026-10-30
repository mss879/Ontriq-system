"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { MODELS } from "@/domain/ai/cost-model";
import type { AiCapabilityRow } from "@/lib/server/billing/queries";
import { saveCapability } from "./actions";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const modelName = (id: string) => Object.values(MODELS).find((m) => m.id === id)?.name ?? id;
const usd = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

/** Each AI capability: on or off, which model, how hard it thinks, and its output cap. */
export function CapabilitiesTable({ capabilities, spend, editable }: { capabilities: AiCapabilityRow[]; spend: Record<string, number>; editable: boolean }) {
  return (
    <ul className="divide-y">
      {capabilities.map((c) => (
        <CapabilityRow key={c.key} cap={c} spend={spend[c.key] ?? 0} editable={editable} />
      ))}
    </ul>
  );
}

function CapabilityRow({ cap, spend, editable }: { cap: AiCapabilityRow; spend: number; editable: boolean }) {
  const claude = cap.model.startsWith("claude-");
  const [v, setV] = useState({ model: cap.model, effort: cap.effort, max_tokens: String(cap.max_tokens), enabled: cap.enabled });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = v.model !== cap.model || v.effort !== cap.effort || Number(v.max_tokens) !== cap.max_tokens || v.enabled !== cap.enabled;

  const save = (next = v) =>
    start(async () => {
      setError(null);
      const r = await saveCapability(cap.key, { model: claude ? next.model : undefined, effort: next.effort as "low", max_tokens: next.max_tokens, enabled: next.enabled });
      if (!r.ok) return setError(r.error);
      toast.success(`${cap.label} saved`);
    });

  return (
    <li className="grid gap-3 px-5 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className={`text-sm font-medium ${v.enabled ? "" : "text-muted-foreground"}`}>{cap.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {cap.description} · {usd(spend)} this month
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          {claude ? (
            <Select value={v.model} onValueChange={(model) => setV({ ...v, model })}>
              <SelectTrigger className="w-40" aria-label={`${cap.label} model`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(MODELS).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="w-40 truncate text-xs text-muted-foreground">{cap.model}</span>
          )}
          {claude ? (
            <>
              <Select value={v.effort} onValueChange={(effort) => setV({ ...v, effort })}>
                <SelectTrigger className="w-28" aria-label={`${cap.label} effort`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EFFORTS.map((e) => (
                    <SelectItem key={e} value={e} className="capitalize">
                      {e} effort
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                inputMode="numeric"
                value={v.max_tokens}
                onChange={(e) => setV({ ...v, max_tokens: e.target.value })}
                className="h-8 w-24 text-right tabular-nums"
                aria-label={`${cap.label} maximum output tokens`}
                title="Maximum output tokens"
              />
            </>
          ) : null}
          <Switch
            checked={v.enabled}
            onCheckedChange={(enabled) => {
              const next = { ...v, enabled };
              setV(next);
              // Switching on or off saves at once; model and limits wait for Save.
              if (!(next.model !== cap.model || next.effort !== cap.effort || Number(next.max_tokens) !== cap.max_tokens)) save(next);
            }}
            disabled={pending}
            aria-label={`${cap.enabled ? "Turn off" : "Turn on"} ${cap.label}`}
          />
          <Button size="sm" variant="outline" className={dirty ? "" : "invisible"} disabled={!dirty || pending} onClick={() => save()}>
            {pending ? <Spinner /> : null} Save
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {v.enabled ? "On" : "Off"} · {modelName(cap.model)}
          {claude ? ` · ${cap.effort} effort · ${cap.max_tokens.toLocaleString()} tokens` : ""}
        </p>
      )}
    </li>
  );
}
