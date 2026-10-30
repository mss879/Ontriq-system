"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveBranding } from "./actions";
import type { Branding } from "@/domain/branding";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { LogoLockup } from "@/components/brand/logo";

export function BrandingForm({ branding, canEdit }: { branding: Branding; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveBranding, null);
  const [primary, setPrimary] = useState(branding.primary_color);
  const [accent, setAccent] = useState(branding.accent_color);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) toast.success("Organisation details saved");
    else if (state && !state.fieldErrors) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} noValidate>
      <fieldset disabled={!canEdit || pending} className="space-y-8">
        <FieldGroup className="grid gap-5 sm:grid-cols-2">
          <TextField name="display_name" label="Display name" defaultValue={branding.display_name} errors={fe?.display_name} />
          <TextField name="legal_name" label="Registered name" defaultValue={branding.legal_name} errors={fe?.legal_name} />
          <TextField name="registration_no" label="Company registration no." defaultValue={branding.registration_no} errors={fe?.registration_no} />
          <TextField name="vat_no" label="VAT registration no." defaultValue={branding.vat_no} errors={fe?.vat_no} />
          <TextField name="phone" label="Phone" type="tel" defaultValue={branding.phone} errors={fe?.phone} />
          <TextField name="email" label="Email" type="email" defaultValue={branding.email} errors={fe?.email} />
          <TextField name="website" label="Website" type="url" placeholder="https://" defaultValue={branding.website} errors={fe?.website} className="sm:col-span-2" />
          <Field className="sm:col-span-2" data-invalid={Boolean(fe?.address) || undefined}>
            <FieldLabel htmlFor="field-address">Address</FieldLabel>
            <Textarea id="field-address" name="address" rows={3} defaultValue={branding.address} />
            <FieldError errors={fe?.address?.map((message) => ({ message }))} />
          </Field>
        </FieldGroup>

        <div className="grid gap-5 sm:grid-cols-2">
          <ColorField name="primary_color" label="Primary colour" value={primary} onChange={setPrimary} errors={fe?.primary_color} />
          <ColorField name="accent_color" label="Accent colour" value={accent} onChange={setAccent} errors={fe?.accent_color} />
        </div>

        <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/10">
          <div className="flex items-center justify-between gap-4 px-5 py-4 text-white" style={{ backgroundColor: primary }}>
            <LogoLockup reversed tagline={false} className="h-8 text-white" />
            <span className="text-right text-[11px] leading-tight opacity-80">
              QUOTATION
              <br />
              QT-2026-0001
            </span>
          </div>
          <div className="h-1" style={{ backgroundColor: accent }} />
          <div className="flex items-center gap-3 bg-card px-5 py-4 text-sm">
            <span className="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium text-white" style={{ backgroundColor: accent }}>
              Highlight
            </span>
            <span className="text-muted-foreground">Primary colours the document header; accent marks rules and key figures.</span>
          </div>
        </div>

        {canEdit ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Save changes
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

function ColorField({ name, label, value, onChange, errors }: { name: string; label: string; value: string; onChange: (v: string) => void; errors?: string[] }) {
  return (
    <Field data-invalid={Boolean(errors?.length) || undefined}>
      <FieldLabel htmlFor={`field-${name}`}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#0c5a9a"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <input
          id={`field-${name}`}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-lg border bg-transparent px-2.5 font-mono text-sm uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}
