"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { createMember } from "./actions";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { generatePassword } from "@/domain/password";

type RoleOption = { id: string; name: string; description: string };

/** Creates a working login on the spot, for someone the admin has already confirmed. */
export function CreateLoginForm({ roles, onDone, modeSwitch }: { roles: RoleOption[]; onDone: () => void; modeSwitch: React.ReactNode }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [password, setPassword] = useState(generatePassword);
  const [shown, setShown] = useState(true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const selected = roles.find((r) => r.id === roleId);

  if (created) {
    const details = `Sign in at ${window.location.origin}/login\nEmail: ${created.email}\nPassword: ${created.password}`;
    return (
      <>
        <DialogHeader className="mb-4">
          <DialogTitle>Login created</DialogTitle>
          <DialogDescription>They can sign in now. Send these details privately.</DialogDescription>
        </DialogHeader>
        <pre className="rounded-lg bg-muted p-3 text-sm break-all whitespace-pre-wrap">{details}</pre>
        <Alert className="mt-4">
          <AlertTitle>This password won&apos;t be shown again</AlertTitle>
          <AlertDescription>Copy it now. Ask them to change it from their account menu after signing in.</AlertDescription>
        </Alert>
        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(details);
              setCopied(true);
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy details"}
          </Button>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const r = await createMember({ fullName, email, roleId, password });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.fieldErrors ? null : r.error);
        return;
      }
      setCreated({ email: r.email, password });
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader className="mb-5">
        <DialogTitle>Add a team member</DialogTitle>
        <DialogDescription>Create their login now and share it with them. No email needed.</DialogDescription>
      </DialogHeader>
      {modeSwitch}
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <TextField name="fullName" label="Full name" autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} errors={errors.fullName} />
        <TextField name="email" label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} errors={errors.email} />
        <Field data-invalid={Boolean(errors.roleId) || undefined}>
          <FieldLabel htmlFor="create-role">Designation</FieldLabel>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="create-role" className="w-full" aria-invalid={Boolean(errors.roleId) || undefined}>
              <SelectValue placeholder="Choose a designation" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected ? <FieldDescription>{selected.description}</FieldDescription> : null}
          <FieldError errors={errors.roleId?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={Boolean(errors.password) || undefined}>
          <FieldLabel htmlFor="create-password">Password</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="create-password"
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              className="font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password) || undefined}
            />
            <Button type="button" variant="outline" size="icon" aria-label={shown ? "Hide password" : "Show password"} onClick={() => setShown((s) => !s)}>
              {shown ? <EyeOff /> : <Eye />}
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label="Make a new password" onClick={() => setPassword(generatePassword())}>
              <RefreshCw />
            </Button>
          </div>
          <FieldDescription>At least 10 characters, with a letter and a number.</FieldDescription>
          <FieldError errors={errors.password?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Create login
        </Button>
      </DialogFooter>
    </form>
  );
}
