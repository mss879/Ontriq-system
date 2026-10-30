"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveRules } from "./actions";
import type { AssignmentRules } from "@/lib/server/admin/settings";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const STRATEGIES = [
  { value: "least_loaded", title: "Least loaded", text: "The person with the lightest workload who is qualified, weighing overdue work and recent output." },
  { value: "round_robin", title: "Take turns", text: "Qualified people in turn, whoever has waited longest since their last case." },
  { value: "manual", title: "Manual", text: "Nothing is assigned automatically. New cases wait in the manager queue." },
] as const;

const WEIGHTS = [
  { key: "load", label: "Workload", text: "Open checks, weighted by effort." },
  { key: "overdue", label: "Overdue work", text: "People with overdue items get less." },
  { key: "recent", label: "Recent output", text: "Favours people who have been finishing work." },
  { key: "newcomer", label: "New starters", text: "A small boost for people in their first 30 days." },
] as const;

export function RulesForm({ rules }: { rules: AssignmentRules }) {
  const [r, setR] = useState(rules);
  const [pending, start] = useTransition();
  const changed = JSON.stringify(r) !== JSON.stringify(rules);

  return (
    <Surface>
      <SurfaceHeader title="Rules" description="How the next case is given out." />
      <div className="space-y-6 px-5 py-5">
        <div role="radiogroup" aria-label="Strategy" className="grid gap-3 md:grid-cols-3">
          {STRATEGIES.map((s) => {
            const active = r.strategy === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setR({ ...r, strategy: s.value })}
                className={cn(
                  "rounded-2xl p-4 text-left ring-1 transition",
                  active ? "bg-primary/[0.06] ring-2 ring-primary" : "bg-card ring-foreground/[0.08] hover:ring-foreground/20",
                )}
              >
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.text}</p>
              </button>
            );
          })}
        </div>

        {r.strategy === "least_loaded" ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Weights</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {WEIGHTS.map((w) => (
                <label key={w.key} className="space-y-1.5 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/[0.05]">
                  <span className="flex items-center justify-between text-sm font-medium">
                    {w.label}
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      className="h-8 w-20 text-right tabular-nums"
                      value={r.weights[w.key]}
                      onChange={(e) => setR({ ...r, weights: { ...r.weights, [w.key]: Number(e.target.value) } })}
                    />
                  </span>
                  <span className="block text-xs text-muted-foreground">{w.text}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["considerSkills", "Match skills", "Only give a check to people set up for that check (people with no skills set take any)."],
              ["considerRegions", "Match regions", "Field checks go to officers who cover the candidate's district (no regions set means anywhere)."],
              ["assignChecks", "Assign each check", "Give every check an officer, preferring the case owner when qualified."],
            ] as const
          ).map(([key, title, text]) => (
            <label key={key} className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 p-3.5 ring-1 ring-foreground/[0.05]">
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{text}</span>
              </span>
              <Switch checked={r[key]} onCheckedChange={(v) => setR({ ...r, [key]: v })} />
            </label>
          ))}
        </div>
      </div>
      {changed ? (
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => setR(rules)} disabled={pending}>
            Reset
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveRules(r);
                if (res.ok) toast.success("Assignment rules saved");
                else toast.error(res.error);
              })
            }
          >
            {pending ? <Spinner /> : null} Save rules
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}
