"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/server/action-result";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

/** Shared by "accept invitation" and "reset password". */
export function PasswordForm({
  action: serverAction,
  submitLabel,
  askName,
  defaultName,
  email,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  askName?: boolean;
  defaultName?: string;
  email?: string;
}) {
  const [state, action, pending] = useActionState(serverAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} noValidate>
      <FieldGroup>
        {state && !state.ok && !fieldErrors ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        {email ? (
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Signing in as </span>
            <span className="font-medium">{email}</span>
          </div>
        ) : null}
        {askName ? (
          <TextField name="fullName" label="Full name" autoComplete="name" defaultValue={defaultName} required errors={fieldErrors?.fullName} />
        ) : null}
        <TextField
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          description="At least 10 characters, with a letter and a number."
          errors={fieldErrors?.password}
        />
        <TextField name="confirm" label="Confirm password" type="password" autoComplete="new-password" required errors={fieldErrors?.confirm} />
        <Button type="submit" variant="brand" size="lg" disabled={pending} className="h-10 w-full">
          {pending ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
