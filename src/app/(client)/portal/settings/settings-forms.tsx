"use client";

import { useState, useTransition } from "react";
import { Check, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { PORTAL_EVENTS } from "./events";
import { saveEmailPreferences, updateMyName } from "./actions";

export function NameForm({ fullName, email }: { fullName: string; email: string }) {
  const [name, setName] = useState(fullName);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateMyName({ fullName: name });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
            return;
          }
          setErrors({});
          toast.success("Name saved");
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="me-name">Full name</FieldLabel>
          <Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <FieldError errors={errors.fullName?.map((message) => ({ message }))} />
        </Field>
        <Field>
          <FieldLabel htmlFor="me-email">Email</FieldLabel>
          <Input id="me-email" value={email} disabled />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={pending || name.trim() === fullName}>
        {pending ? <Spinner /> : <Check />} Save name
      </Button>
    </form>
  );
}

export function EmailPreferences({ initial }: { initial: Record<string, boolean> }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();
  const save = (next: Record<string, boolean>) => {
    setPrefs(next);
    start(async () => {
      const r = await saveEmailPreferences(next);
      if (!r.ok) {
        toast.error(r.error);
        setPrefs(prefs);
      } else toast.success("Preferences saved");
    });
  };
  return (
    <ul className="divide-y divide-border/70">
      {PORTAL_EVENTS.map((e) => (
        <li key={e.type} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
            <Mail className="size-4" />
          </span>
          <label htmlFor={`pref-${e.type}`} className="min-w-0 flex-1 cursor-pointer">
            <span className="block text-sm font-medium">{e.label}</span>
            <span className="block text-[13px] text-muted-foreground">{e.text}</span>
          </label>
          <Switch id={`pref-${e.type}`} checked={prefs[e.type] ?? true} disabled={pending} onCheckedChange={(v) => save({ ...prefs, [e.type]: v })} aria-label={`Email me: ${e.label}`} />
        </li>
      ))}
    </ul>
  );
}
