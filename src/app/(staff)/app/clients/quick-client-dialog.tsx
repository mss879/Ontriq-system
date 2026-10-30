"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClientRecord, suggestClientCode } from "./actions";
import { EMPTY_CLIENT } from "./client-form-dialog";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

export type QuickClient = { id: string; name: string; code: string; status: string; slaDays: number };

/**
 * Add a client without leaving what you're doing, such as a half-finished case.
 * Only the essentials: everything else takes the usual defaults and can be
 * filled in later on the client's page.
 */
export function QuickClientDialog({
  open,
  onOpenChange,
  initialName = "",
  existing,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Starts the name field, e.g. from a search that found nothing. */
  initialName?: string;
  /** Clients already on file, to catch a duplicate before it's made. */
  existing: { id: string; name: string }[];
  /** The client to use: the new one, or an existing one with the same name. */
  onPick: (client: { id: string } & Partial<QuickClient>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <QuickClientForm initialName={initialName} existing={existing} onPick={onPick} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function QuickClientForm({ initialName, existing, onPick, onCancel }: { initialName: string; existing: { id: string; name: string }[]; onPick: (client: { id: string } & Partial<QuickClient>) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const codeTouched = useRef(false);

  const suggest = (value: string) =>
    startSuggest(async () => {
      const r = await suggestClientCode(value);
      if (r.ok && r.code && !codeTouched.current) setCode(r.code);
    });

  useEffect(() => {
    if (initialName.trim().length >= 2) suggest(initialName);
    // Only for the name the dialog opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duplicate = existing.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const r = await createClientRecord({ ...EMPTY_CLIENT, name, code, email });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.fieldErrors ? null : r.error);
        return;
      }
      toast.success(`${name.trim()} added`, { description: "Add contacts or a portal login any time from the client's page." });
      onPick({ id: r.id, name: name.trim(), code: code.trim().toUpperCase(), status: EMPTY_CLIENT.status, slaDays: EMPTY_CLIENT.slaDays });
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader className="mb-5">
        <DialogTitle>New client</DialogTitle>
        <DialogDescription>Just the essentials, so you can carry on. The rest can wait for the client&apos;s page.</DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending} className="space-y-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <TextField name="quickName" label="Company name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={(e) => suggest(e.target.value)} errors={errors.name} />
        {duplicate ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-warning/10 px-3 py-2 text-sm">
            <p className="min-w-0">{duplicate.name} is already a client.</p>
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => onPick({ id: duplicate.id })}>
              Use this client
            </Button>
          </div>
        ) : null}
        <TextField
          name="quickCode"
          label="Client code"
          value={code}
          onChange={(e) => {
            codeTouched.current = true;
            setCode(e.target.value.toUpperCase());
          }}
          description="Short and unique, e.g. HEMAS. Used in references and files."
          errors={errors.code}
          labelAside={
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50 dark:text-brand-sky"
              disabled={suggesting || name.trim().length < 2}
              onClick={() => {
                codeTouched.current = false;
                suggest(name);
              }}
            >
              {suggesting ? <Spinner className="size-3" /> : <Sparkles className="size-3" />} Suggest
            </button>
          }
        />
        <TextField name="quickEmail" label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} errors={errors.email} />
      </fieldset>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Add client
        </Button>
      </DialogFooter>
    </form>
  );
}
