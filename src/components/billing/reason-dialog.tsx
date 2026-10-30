"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Result = { ok: true } | { ok: false; error: string };

/** Ask for a reason, run the action, show the refusal inline. Resets when closed. */
export function BillingReasonDialog({
  trigger,
  title,
  description,
  label = "Reason",
  confirmLabel,
  destructive = false,
  success,
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  label?: string;
  confirmLabel: string;
  destructive?: boolean;
  success: string;
  onSubmit: (text: string) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setText("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return setError(`Add a ${label.toLowerCase()} first.`);
            start(async () => {
              const r = await onSubmit(text.trim());
              if (!r.ok) return setError(r.error);
              toast.success(success);
              setOpen(false);
              setText("");
            });
          }}
        >
          <DialogHeader className="mb-4">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {label}
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus aria-invalid={Boolean(error) || undefined} />
          </label>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="mt-5">
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {pending ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
