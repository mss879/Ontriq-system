"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { savePerformanceRules } from "./actions";
import type { PerformanceRules } from "@/lib/server/performance/queries";
import { PARTS, PART_LABELS, type Part } from "@/domain/performance/score-core";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

const PART_TEXT: Record<Part, string> = {
  throughput: "Checks completed, against the busiest person.",
  timeliness: "Checks finished by their due date.",
  quality: "Fewer checks sent back by QC.",
  responsiveness: "How soon new work is started (4 hours or less is full marks).",
};

type State = { weights: Record<Part, number>; autoNudge: PerformanceRules["autoNudge"] };

export function PerformanceRulesForm({ rules }: { rules: PerformanceRules }) {
  const initial: State = { weights: { ...rules.rawWeights }, autoNudge: { ...rules.autoNudge } };
  const [s, setS] = useState<State>(initial);
  const [pending, start] = useTransition();
  const changed = JSON.stringify(s) !== JSON.stringify(initial);
  const sum = PARTS.reduce((a, p) => a + (Number.isFinite(s.weights[p]) ? Math.max(0, s.weights[p]) : 0), 0);
  const pct = (p: Part) => (sum > 0 ? Math.round((100 * Math.max(0, s.weights[p] || 0)) / sum) : 0);
  const setNudge = (patch: Partial<State["autoNudge"]>) => setS({ ...s, autoNudge: { ...s.autoNudge, ...patch } });

  return (
    <Surface>
      <SurfaceHeader title="Performance and pushes" description="How the leaderboard scores people, and when someone who is behind is pushed automatically." />
      <div className="space-y-6 px-5 py-5">
        <div className="space-y-3">
          <p className="text-sm font-medium">Score weights</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PARTS.map((p) => (
              <label key={p} className="space-y-1.5 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/[0.05]">
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {PART_LABELS[p]}
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label={`${PART_LABELS[p]} weight`}
                    className="h-8 w-20 text-right tabular-nums"
                    value={s.weights[p]}
                    onChange={(e) => setS({ ...s, weights: { ...s.weights, [p]: Number(e.target.value) } })}
                  />
                </span>
                <span className="block text-xs text-muted-foreground">{PART_TEXT[p]}</span>
                <span className="block text-xs font-medium tabular-nums text-foreground/80">{pct(p)}% of the score</span>
              </label>
            ))}
          </div>
          {sum <= 0 ? <p className="text-xs text-destructive">Give at least one measure some weight.</p> : null}
        </div>

        <div className="space-y-3">
          <label className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 p-3.5 ring-1 ring-foreground/[0.05]">
            <span>
              <span className="block text-sm font-medium">Push automatically</span>
              <span className="block text-xs text-muted-foreground">
                Send a constructive push to anyone with too many items overdue for too long. At most once a day per person; their managers are told.
              </span>
            </span>
            <Switch checked={s.autoNudge.enabled} onCheckedChange={(v) => setNudge({ enabled: v })} aria-label="Push automatically" />
          </label>
          {s.autoNudge.enabled ? (
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1.5 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/[0.05]">
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  Overdue items
                  <Input type="number" min={1} max={50} step={1} className="h-8 w-20 text-right tabular-nums" value={s.autoNudge.overdueItems} onChange={(e) => setNudge({ overdueItems: Number(e.target.value) })} />
                </span>
                <span className="block text-xs text-muted-foreground">How many overdue items before a push.</span>
              </label>
              <label className="space-y-1.5 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/[0.05]">
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  Overdue for (hours)
                  <Input type="number" min={1} max={168} step={1} className="h-8 w-20 text-right tabular-nums" value={s.autoNudge.hours} onChange={(e) => setNudge({ hours: Number(e.target.value) })} />
                </span>
                <span className="block text-xs text-muted-foreground">Only items late by at least this long count.</span>
              </label>
              <label className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/[0.05]">
                <span>
                  <span className="block text-sm font-medium">Escalate a second push</span>
                  <span className="block text-xs text-muted-foreground">If they are pushed again within a week, alert their managers.</span>
                </span>
                <Switch checked={s.autoNudge.escalate} onCheckedChange={(v) => setNudge({ escalate: v })} aria-label="Escalate a second push" />
              </label>
            </div>
          ) : null}
        </div>
      </div>
      {changed ? (
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => setS(initial)} disabled={pending}>
            Reset
          </Button>
          <Button
            size="sm"
            disabled={pending || sum <= 0}
            onClick={() =>
              start(async () => {
                const res = await savePerformanceRules(s);
                if (res.ok) toast.success("Performance settings saved");
                else toast.error(res.error);
              })
            }
          >
            {pending ? <Spinner /> : null} Save
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}
