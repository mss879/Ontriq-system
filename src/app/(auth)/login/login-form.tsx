"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { signIn } from "../actions";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const NOTICES: Record<string, string> = {
  link: "That link has expired or was already used. Sign in, or ask for a new link.",
  "no-access": "Your account doesn't have access yet. Ask your administrator for an invitation.",
  session: "Your session ended. Please sign in again.",
};

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const message = state && !state.ok ? state.error : notice ? NOTICES[notice] : undefined;

  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <FieldGroup>
        {message ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <TextField name="email" label="Email" type="email" autoComplete="email" autoFocus required errors={fieldErrors?.email} />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          errors={fieldErrors?.password}
          labelAside={
            <Link href="/forgot-password" className="text-xs font-medium text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
          }
        />
        <Button type="submit" variant="brand" size="lg" disabled={pending} className="h-10 w-full">
          {pending ? <Spinner /> : null}
          Sign in
        </Button>
      </FieldGroup>
    </form>
  );
}
