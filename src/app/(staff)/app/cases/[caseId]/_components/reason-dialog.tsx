"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Result = { ok: true } | { ok: false; error: string };

/**
 * A small dialog that asks for a reason or note, runs an action, and shows
 * the database's refusal inline. The form resets every time it closes.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  label = "Reason",
  placeholder,
  confirmLabel,
  required = true,
  destructive = false,
  success,
  onSubmit,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  required?: boolean;
  destructive?: boolean;
  success?: string;
  onSubmit: (text: string) => Promise<Result>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInnerOpen(next);
  };
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFormKey((k) => k + 1);
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <ReasonForm
          key={formKey}
          title={title}
          description={description}
          label={label}
          placeholder={placeholder}
          confirmLabel={confirmLabel}
          required={required}
          destructive={destructive}
          onSubmit={onSubmit}
          onDone={() => {
            if (success) toast.success(success);
            setOpen(false);
            setFormKey((k) => k + 1);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  title,
  description,
  label,
  placeholder,
  confirmLabel,
  required,
  destructive,
  onSubmit,
  onDone,
}: {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  confirmLabel: string;
  required: boolean;
  destructive: boolean;
  onSubmit: (text: string) => Promise<Result>;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `reason-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (required && !text.trim()) {
          setError(`Add a ${label.toLowerCase()} first.`);
          return;
        }
        start(async () => {
          const result = await onSubmit(text.trim());
          if (result.ok) onDone();
          else setError(result.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {required ? null : <span className="font-normal text-muted-foreground"> (optional)</span>}
        </label>
        <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={3} aria-invalid={Boolean(error) || undefined} autoFocus />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-5">
        <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
          {pending ? <Spinner /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
