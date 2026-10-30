"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Scale } from "lucide-react";
import { toast } from "sonner";
import { applyRebalance, proposeRebalance } from "@/app/(staff)/app/team/performance/actions";
import type { Move } from "@/domain/performance/rebalance-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

type Overloaded = { name: string; openChecks: number; maxOpenChecks: number; overdue: number };

/** Rules-based rebalance: proposed moves from overloaded people to the freest qualified ones, confirmed by a manager. */
export function RebalanceDialog() {
  const [open, setOpen] = useState(false);
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [overloaded, setOverloaded] = useState<Overloaded[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loading, startLoad] = useTransition();
  const [applying, startApply] = useTransition();

  const load = () =>
    startLoad(async () => {
      const res = await proposeRebalance();
      if (!res.ok) {
        toast.error(res.error);
        setMoves([]);
        return;
      }
      setMoves(res.moves);
      setOverloaded(res.overloaded);
      setChosen(new Set(res.moves.map((m) => m.checkId)));
    });

  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
        else setMoves(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="h-9">
          <Scale /> Rebalance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rebalance the work</DialogTitle>
          <DialogDescription>
            Moves open checks away from people over capacity or with three or more overdue items, to the freest qualified people. Work already started stays put. Nothing moves until you confirm.
          </DialogDescription>
        </DialogHeader>

        {loading || moves === null ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : !moves.length ? (
          <p className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            {overloaded.length
              ? `${overloaded.map((o) => o.name).join(", ")} ${overloaded.length === 1 ? "is" : "are"} stretched, but nobody qualified has room to take their unstarted checks.`
              : "Nobody is over capacity or far behind. Nothing to move."}
          </p>
        ) : (
          <div className="space-y-3">
            {overloaded.length ? (
              <p className="text-xs text-muted-foreground">
                Stretched: {overloaded.map((o) => `${o.name} (${o.openChecks}/${o.maxOpenChecks} open, ${o.overdue} overdue)`).join("; ")}
              </p>
            ) : null}
            <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-xl ring-1 ring-foreground/[0.08]">
              {moves.map((m) => (
                <li key={m.checkId}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
                    <Checkbox className="mt-0.5" checked={chosen.has(m.checkId)} onCheckedChange={(v) => toggle(m.checkId, v === true)} aria-label={`Move ${m.reference} ${m.label}`} />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/app/cases/${m.caseId}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                          {m.reference}
                        </Link>
                        <span className="text-muted-foreground">{m.label}</span>
                        {m.overdue ? <Badge className="bg-destructive/10 text-destructive">Overdue</Badge> : null}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs">
                        {m.from.name} <ArrowRight className="size-3 text-muted-foreground" /> <span className="font-medium">{m.to.name}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">{m.reason}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={applying}>
            Cancel
          </Button>
          <Button
            disabled={applying || loading || !moves?.length || chosen.size === 0}
            onClick={() =>
              startApply(async () => {
                const picked = (moves ?? []).filter((m) => chosen.has(m.checkId)).map((m) => ({ checkId: m.checkId, toUserId: m.to.userId, reason: m.reason }));
                const res = await applyRebalance(picked);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                if (res.failed.length) toast.warning(`Moved ${res.moved}; ${res.failed.length} couldn't move (${res.failed[0].error})`);
                else toast.success(`Moved ${res.moved} check${res.moved === 1 ? "" : "s"}`);
                setOpen(false);
              })
            }
          >
            {applying ? <Spinner /> : null} Move {chosen.size || ""} check{chosen.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
