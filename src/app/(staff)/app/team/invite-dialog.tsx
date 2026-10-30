"use client";

import { useActionState, useState } from "react";
import { Check, Copy, MailCheck, UserPlus } from "lucide-react";
import { inviteMember } from "./actions";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type RoleOption = { id: string; name: string; description: string };

export function InviteDialog({ roles, defaultOpen }: { roles: RoleOption[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
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
        <Button size="lg" className="h-9 px-3.5">
          <UserPlus /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <InviteForm key={formKey} roles={roles} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ roles, onDone }: { roles: RoleOption[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(inviteMember, null);
  const [roleId, setRoleId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const selected = roles.find((r) => r.id === roleId);

  if (state?.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Invitation sent</DialogTitle>
          <DialogDescription>They’ll get an email with a one-time link to set their password and two-step verification.</DialogDescription>
        </DialogHeader>
        <Alert>
          <MailCheck />
          <AlertTitle>Link valid for 24 hours</AlertTitle>
          <AlertDescription>You can resend it from the team list at any time.</AlertDescription>
        </Alert>
        {state.devLink ? (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">Email isn’t configured, so here is the link (development only):</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(state.devLink!);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy invite link"}
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form action={action} noValidate>
      <DialogHeader className="mb-5">
        <DialogTitle>Invite a team member</DialogTitle>
        <DialogDescription>Choose their designation. You can change it later.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {state && !state.ok && !fieldErrors ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <TextField name="fullName" label="Full name" autoComplete="off" required errors={fieldErrors?.fullName} />
        <TextField name="email" label="Work email" type="email" autoComplete="off" required errors={fieldErrors?.email} />
        <Field data-invalid={Boolean(fieldErrors?.roleId) || undefined}>
          <FieldLabel htmlFor="invite-role">Designation</FieldLabel>
          <input type="hidden" name="roleId" value={roleId} />
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="invite-role" className="w-full" aria-invalid={Boolean(fieldErrors?.roleId) || undefined}>
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
          <FieldError errors={fieldErrors?.roleId?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  );
}
