"use client";

import { useState, useTransition } from "react";
import { ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { eraseCaseData } from "../erase-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/** Super Admin only: erase a closed case's personal data on request (cannot be undone). */
export function EraseCaseDialog({ caseId, reference }: { caseId: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = reason.trim().length >= 5 && confirm.trim().toUpperCase() === reference.toUpperCase();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setConfirm("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <ShieldOff /> Erase personal data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Erase the candidate&apos;s personal data</DialogTitle>
          <DialogDescription>
            Names, numbers, answers, messages, extracted text and every stored file for this case are removed for good. The reference, client, dates, results and invoices stay. This
            can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            setError(null);
            start(async () => {
              const r = await eraseCaseData({ caseId, reason, confirmReference: confirm });
              if (r.ok) {
                toast.success(`Personal data erased · ${r.files} file${r.files === 1 ? "" : "s"} removed`);
                if (r.left) toast.warning(`${r.left} file${r.left === 1 ? "" : "s"} couldn't be removed yet. The nightly job will try again.`);
                setOpen(false);
              } else setError(r.error);
            });
          }}
        >
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Reason</span>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The candidate asked for their data to be deleted (email of 30 October)." />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">
              Type <span className="font-mono">{reference}</span> to confirm
            </span>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || pending}>
              {pending ? <Spinner /> : <ShieldOff />} Erase for good
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
