"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Pencil, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createClientRecord, suggestClientCode, updateClientRecord, type ClientInput } from "./actions";
import { InviteLinkNotice } from "./[clientId]/invite-link-notice";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_OPTIONS } from "./client-status";

export type ClientFormValues = {
  name: string;
  code: string;
  legalName: string;
  registrationNo: string;
  vatNo: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  slaDays: number;
  paymentTermsDays: number;
  status: "prospect" | "active" | "suspended" | "archived";
  notes: string;
};

const EMPTY: ClientFormValues = {
  name: "",
  code: "",
  legalName: "",
  registrationNo: "",
  vatNo: "",
  industry: "",
  website: "",
  email: "",
  phone: "",
  address: "",
  slaDays: 7,
  paymentTermsDays: 30,
  status: "active",
  notes: "",
};

export function ClientFormDialog({ mode, clientId, initial, onDark }: { mode: "create" | "edit"; clientId?: string; initial?: ClientFormValues; onDark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="lg" className="h-9 px-3.5">
            <Building2 /> New client
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={onDark ? "border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white dark:border-white/20 dark:bg-white/10" : undefined}
          >
            <Pencil /> Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <ClientForm key={formKey} mode={mode} clientId={clientId} initial={initial ?? EMPTY} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ClientForm({ mode, clientId, initial, onDone }: { mode: "create" | "edit"; clientId?: string; initial: ClientFormValues; onDone: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState<ClientFormValues>(initial);
  const [portalAdmin, setPortalAdmin] = useState({ fullName: "", email: "" });
  const [devLink, setDevLink] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const codeTouched = useRef(mode === "edit");

  const set = <K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const suggest = (name: string) =>
    startSuggest(async () => {
      const r = await suggestClientCode(name);
      if (r.ok && r.code && !codeTouched.current) setValues((v) => ({ ...v, code: r.code }));
    });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const input: ClientInput = { ...values };
      if (mode === "create") {
        const result = await createClientRecord(input, portalAdmin);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.fieldErrors ? null : result.error);
          return;
        }
        const invite = result.invite;
        if (invite && !invite.ok) toast.warning(`${values.name} added, but the portal invitation failed`, { description: `${invite.error} Invite them again from the client page.` });
        else toast.success(`${values.name} added`, invite ? { description: `Portal invitation sent to ${portalAdmin.email}.` } : undefined);
        // In development without email, show the setup link before leaving.
        if (invite?.ok && invite.devLink) {
          setDevLink(invite.devLink);
          setCreatedId(result.id);
          return;
        }
        onDone();
        router.push(`/app/clients/${result.id}`);
        return;
      }
      const result = await updateClientRecord(clientId!, input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : result.error);
        return;
      }
      toast.success("Client details saved");
      onDone();
    });
  };

  if (devLink && createdId) {
    return (
      <div className="space-y-5">
        <DialogHeader>
          <DialogTitle>{values.name} added</DialogTitle>
          <DialogDescription>Email isn&apos;t set up here, so the portal invitation wasn&apos;t sent. Share this one-time setup link with {portalAdmin.fullName}.</DialogDescription>
        </DialogHeader>
        <InviteLinkNotice url={devLink} />
        <DialogFooter>
          <Button
            onClick={() => {
              onDone();
              router.push(`/app/clients/${createdId}`);
            }}
          >
            Open the client
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader className="mb-5">
        <DialogTitle>{mode === "create" ? "New client" : "Edit client"}</DialogTitle>
        <DialogDescription>
          {mode === "create" ? "The company that orders verifications. Add a portal admin to give them their own login." : "Changes are recorded in the audit log."}
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending}>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {formError ? (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <TextField
            name="name"
            label="Company name"
            value={values.name}
            autoFocus={mode === "create"}
            onChange={(e) => set("name", e.target.value)}
            onBlur={(e) => mode === "create" && suggest(e.target.value)}
            errors={errors.name}
          />
          <TextField
            name="code"
            label="Client code"
            value={values.code}
            onChange={(e) => {
              codeTouched.current = true;
              set("code", e.target.value.toUpperCase());
            }}
            description="Short and unique, e.g. HEMAS. Used in references and files."
            errors={errors.code}
            labelAside={
              mode === "create" ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  disabled={suggesting || values.name.trim().length < 2}
                  onClick={() => {
                    codeTouched.current = false;
                    suggest(values.name);
                  }}
                >
                  {suggesting ? <Spinner className="size-3" /> : <Sparkles className="size-3" />} Suggest
                </button>
              ) : null
            }
          />
          <TextField name="legalName" label="Registered name" value={values.legalName} onChange={(e) => set("legalName", e.target.value)} errors={errors.legalName} />
          <TextField name="industry" label="Industry" value={values.industry} onChange={(e) => set("industry", e.target.value)} errors={errors.industry} />
          <TextField name="email" label="Email" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} errors={errors.email} />
          <TextField name="phone" label="Phone" type="tel" placeholder="+94 11 234 5678" value={values.phone} onChange={(e) => set("phone", e.target.value)} errors={errors.phone} />
          <TextField name="registrationNo" label="Company registration no." value={values.registrationNo} onChange={(e) => set("registrationNo", e.target.value)} errors={errors.registrationNo} />
          <TextField name="vatNo" label="VAT no." value={values.vatNo} onChange={(e) => set("vatNo", e.target.value)} errors={errors.vatNo} />
          <TextField
            name="website"
            label="Website"
            type="url"
            placeholder="https://"
            className="sm:col-span-2"
            value={values.website}
            onChange={(e) => set("website", e.target.value)}
            errors={errors.website}
          />
          <Field className="sm:col-span-2" data-invalid={Boolean(errors.address) || undefined}>
            <FieldLabel htmlFor="client-address">Address</FieldLabel>
            <Textarea id="client-address" rows={2} value={values.address} onChange={(e) => set("address", e.target.value)} />
            <FieldError errors={errors.address?.map((message) => ({ message }))} />
          </Field>
          <TextField
            name="slaDays"
            label="Turnaround (working days)"
            type="number"
            min={1}
            max={120}
            value={String(values.slaDays)}
            onChange={(e) => set("slaDays", Number(e.target.value))}
            description="Used when a case has no package turnaround."
            errors={errors.slaDays}
          />
          <TextField
            name="paymentTermsDays"
            label="Payment terms (days)"
            type="number"
            min={0}
            max={180}
            value={String(values.paymentTermsDays)}
            onChange={(e) => set("paymentTermsDays", Number(e.target.value))}
            errors={errors.paymentTermsDays}
          />
          <Field className="sm:col-span-2">
            <FieldLabel>Status</FieldLabel>
            <Select value={values.status} onValueChange={(v) => set("status", v as ClientFormValues["status"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label} <span className="text-muted-foreground">· {s.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2" data-invalid={Boolean(errors.notes) || undefined}>
            <FieldLabel htmlFor="client-notes">Internal notes</FieldLabel>
            <Textarea id="client-notes" rows={2} value={values.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Only Ontriq staff see this." />
            <FieldError errors={errors.notes?.map((message) => ({ message }))} />
          </Field>
          {mode === "create" ? (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4 sm:col-span-2">
              <div className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserPlus className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">Portal admin (optional)</p>
                  <p className="text-xs text-muted-foreground">They get an email to set a password, then request verifications, follow progress and invite colleagues.</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  name="portalAdminName"
                  label="Full name"
                  value={portalAdmin.fullName}
                  onChange={(e) => setPortalAdmin((p) => ({ ...p, fullName: e.target.value }))}
                  errors={errors["portalAdmin.fullName"]}
                />
                <TextField
                  name="portalAdminEmail"
                  label="Work email"
                  type="email"
                  value={portalAdmin.email}
                  onChange={(e) => setPortalAdmin((p) => ({ ...p, email: e.target.value }))}
                  errors={errors["portalAdmin.email"]}
                />
              </div>
            </div>
          ) : null}
        </FieldGroup>
      </fieldset>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {mode === "create" ? "Add client" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
