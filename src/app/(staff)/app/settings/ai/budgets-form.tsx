"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AiBudgetRow } from "@/lib/server/billing/queries";
import { saveBudget } from "./actions";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Daily and monthly spending limits. "Pause" stops non-essential AI calls once a limit is reached; "Alert" only warns. */
export function BudgetsForm({ budgets, labels, spent, editable }: { budgets: AiBudgetRow[]; labels: Record<string, string>; spent: Record<string, { today: number; month: number }>; editable: boolean }) {
  return (
    <ul className="divide-y">
      {budgets.map((b) => (
        <BudgetRow key={b.id} budget={b} label={b.capability ? (labels[b.capability] ?? b.capability) : "Whole organisation"} spent={spent[b.capability ?? ""] ?? { today: 0, month: 0 }} editable={editable} />
      ))}
    </ul>
  );
}

function BudgetRow({ budget, label, spent, editable }: { budget: AiBudgetRow; label: string; spent: { today: number; month: number }; editable: boolean }) {
  const initial = { daily: budget.daily_usd === null ? "" : String(budget.daily_usd), monthly: budget.monthly_usd === null ? "" : String(budget.monthly_usd), action: budget.action };
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = v.daily !== initial.daily || v.monthly !== initial.monthly || v.action !== initial.action;
  const monthPct = budget.monthly_usd ? Math.min(100, (spent.month / budget.monthly_usd) * 100) : 0;

  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {usd(spent.today)} today · {usd(spent.month)} this month
        </p>
      </div>
      {budget.monthly_usd ? (
        <div className="space-y-1">
          <Progress value={monthPct} aria-label={`${label}: ${Math.round(monthPct)}% of the monthly budget used`} />
          <p className="text-[11px] text-muted-foreground">{Math.round(monthPct)}% of the monthly limit</p>
        </div>
      ) : null}
      {editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Per day (USD)
            <Input inputMode="decimal" value={v.daily} placeholder="No limit" onChange={(e) => setV({ ...v, daily: e.target.value })} className="h-8 w-28 tabular-nums" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Per month (USD)
            <Input inputMode="decimal" value={v.monthly} placeholder="No limit" onChange={(e) => setV({ ...v, monthly: e.target.value })} className="h-8 w-28 tabular-nums" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            When reached
            <Select value={v.action} onValueChange={(action) => setV({ ...v, action })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alert">Alert only</SelectItem>
                <SelectItem value="pause">Pause AI calls</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await saveBudget(budget.id, { daily_usd: v.daily, monthly_usd: v.monthly, action: v.action as "alert" });
                if (!r.ok) return setError(r.error);
                toast.success("Budget saved");
              })
            }
          >
            {pending ? <Spinner /> : null} Save
          </Button>
          {error ? (
            <p role="alert" className="w-full text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {budget.daily_usd !== null ? `${usd(budget.daily_usd)} a day` : "No daily limit"} · {budget.monthly_usd !== null ? `${usd(budget.monthly_usd)} a month` : "no monthly limit"} ·{" "}
          {budget.action === "pause" ? "pauses AI calls" : "alerts only"}
        </p>
      )}
    </li>
  );
}
