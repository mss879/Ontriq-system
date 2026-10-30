"use client";

import Link from "next/link";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { requestPasswordReset } from "../actions";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);

  if (state?.ok) {
    return (
      <div className="space-y-6">
        <Alert>
          <MailCheck />
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>If that email belongs to an account, a reset link is on its way. It expires in 24 hours.</AlertDescription>
        </Alert>
        {state.devLink ? (
          <p className="rounded-lg border border-dashed p-3 text-xs break-all text-muted-foreground">
            Development only (email not configured):{" "}
            <a className="font-medium text-foreground underline" href={state.devLink}>
              open the reset link
            </a>
          </p>
        ) : null}
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} noValidate>
      <FieldGroup>
        {state && !state.ok && !fieldErrors ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <TextField name="email" label="Email" type="email" autoComplete="email" autoFocus required errors={fieldErrors?.email} />
        <Button type="submit" variant="brand" size="lg" disabled={pending} className="h-10 w-full">
          {pending ? <Spinner /> : null}
          Send reset link
        </Button>
        <Link href="/login" className="text-center text-sm font-medium text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </FieldGroup>
    </form>
  );
}
