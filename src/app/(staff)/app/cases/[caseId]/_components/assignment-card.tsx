"use client";

import { useState, useTransition } from "react";
import { Bot, Hand, Inbox, Sparkles, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { assignCases, autoAssignAgain } from "../../actions";
import type { AssignmentRecord, Person, StaffOption } from "@/lib/server/cases/queries";
import { PersonAvatar, PersonChip } from "@/components/cases/person";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const QUEUE = "__queue__";

export function AssignmentCard({
  caseId,
  owner,
  explanation,
  history,
  staff,
  canAssign,
  closed,
}: {
  caseId: string;
  owner: Person | null;
  explanation: string | null;
  history: AssignmentRecord[];
  staff: StaffOption[];
  canAssign: boolean;
  closed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [pending, start] = useTransition();
  const caseHistory = history.filter((h) => !h.caseCheckId).slice(0, 5);

  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Case owner</h2>
        {canAssign && !closed ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <UserRoundCog /> Reassign
          </Button>
        ) : null}
      </div>
      <div className="mt-3">
        {owner ? (
          <div className="flex items-center gap-3">
            <PersonAvatar id={owner.id} name={owner.name} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{owner.name}</p>
              <p className="truncate text-xs text-muted-foreground">{owner.email}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-warning/10 px-3 py-2.5">
            <Inbox className="size-4 text-warning-foreground dark:text-warning" />
            <p className="text-sm">Waiting in the manager queue</p>
          </div>
        )}
        {explanation ? (
          <p className="mt-3 flex gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-orange" aria-hidden />
            <span>{explanation}</span>
          </p>
        ) : null}
        {!owner && canAssign && !closed ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await autoAssignAgain(caseId);
                if (r.ok) toast.success("Auto-assignment is running", { description: "The page updates when it finishes." });
                else toast.error(r.error);
              })
            }
          >
            {pending ? <Spinner /> : <Bot />} Try auto-assign again
          </Button>
        ) : null}
      </div>

      {caseHistory.length ? (
        <ol className="mt-4 space-y-2.5 border-t pt-4">
          {caseHistory.map((h) => (
            <li key={h.id} className="flex gap-2.5 text-xs">
              <span className="mt-0.5 text-muted-foreground">{h.mode === "auto" ? <Bot className="size-3.5" /> : h.mode === "queue" ? <Inbox className="size-3.5" /> : <Hand className="size-3.5" />}</span>
              <div className="min-w-0 flex-1">
                <p>
                  {h.mode === "queue" ? "Manager queue" : h.mode === "auto" ? "Auto-assigned to " : "Assigned to "}
                  {h.assignee ? <span className="font-medium">{h.assignee.name}</span> : null}
                  {h.by && h.mode !== "auto" ? <span className="text-muted-foreground"> by {h.by.name}</span> : null}
                </p>
                {h.reason ? <p className="text-muted-foreground">{h.reason}</p> : null}
                <RelativeTime iso={h.at} className="text-muted-foreground" />
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setFormKey((k) => k + 1);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <ReassignForm
            key={formKey}
            caseId={caseId}
            staff={staff}
            currentId={owner?.id ?? null}
            onDone={() => {
              setOpen(false);
              setFormKey((k) => k + 1);
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ReassignForm({ caseId, staff, currentId, onDone }: { caseId: string; staff: StaffOption[]; currentId: string | null; onDone: () => void }) {
  const [who, setWho] = useState<string>(currentId ?? QUEUE);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignCases([caseId], who === QUEUE ? null : who, reason);
          if (r.ok) {
            toast.success(who === QUEUE ? "Moved to the manager queue" : `Assigned to ${staff.find((s) => s.id === who)?.name ?? "them"}`);
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Reassign the case</DialogTitle>
        <DialogDescription>The new owner also picks up any checks nobody holds yet, and gets a notification.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="reassign-who" className="text-sm font-medium">
            Owner
          </label>
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger id="reassign-who" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={QUEUE}>Manager queue (nobody)</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <PersonChip person={s} /> <span className="text-xs text-muted-foreground">{s.roleName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reassign-reason" className="text-sm font-medium">
            Reason <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea id="reassign-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Covering while Nimal is on leave." />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending || who === (currentId ?? QUEUE)}>
          {pending ? <Spinner /> : null}
          Reassign
        </Button>
      </DialogFooter>
    </form>
  );
}
