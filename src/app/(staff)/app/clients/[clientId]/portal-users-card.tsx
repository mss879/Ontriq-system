"use client";

import { useState, useTransition } from "react";
import { MailCheck, MoreHorizontal, RotateCcw, Send, ShieldOff, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { invitePortalUser, resendPortalUserInvite, setPortalUserAccess } from "../actions";
import type { PortalUser } from "@/lib/server/admin/portal";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { PersonAvatar } from "@/components/cases/person";
import { RelativeTime } from "@/components/cases/sla-badge";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { Tone } from "@/domain/workflow/stages";
import { InviteLinkNotice } from "./invite-link-notice";

type Role = { id: string; key: string; name: string; description: string };

const STATUS: Record<PortalUser["status"], { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  invited: { label: "Invited", tone: "info" },
  suspended: { label: "Suspended", tone: "neutral" },
};

/** The client company's portal logins. Ontriq invites the first admin; client admins can invite colleagues themselves. */
export function PortalUsersCard({ clientId, clientName, users, roles, canEdit, clientActive }: { clientId: string; clientName: string; users: PortalUser[]; roles: Role[]; canEdit: boolean; clientActive: boolean }) {
  const [inviting, setInviting] = useState(false);
  const active = users.filter((u) => u.status === "active").length;
  return (
    <Surface>
      <SurfaceHeader
        title="Portal users"
        description={users.length ? `${active} active of ${users.length}. They see only ${clientName}'s cases, and only what Ontriq shares.` : "Nobody from this client can sign in to the portal yet."}
        aside={
          canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setInviting(true)} disabled={!clientActive}>
              <UserPlus /> Invite
            </Button>
          ) : null
        }
      />
      {users.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0" />
          {canEdit
            ? clientActive
              ? "Invite their HR lead as Client Admin: they can request verifications, follow progress and invite colleagues."
              : "Activate the client before inviting portal users."
            : "No portal users yet."}
        </div>
      ) : (
        <ul className="divide-y">
          {users.map((u) => (
            <UserRow key={u.membershipId} user={u} roles={roles} canEdit={canEdit} />
          ))}
        </ul>
      )}
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent className="sm:max-w-md">{inviting ? <InviteForm clientId={clientId} clientName={clientName} roles={roles} onDone={() => setInviting(false)} /> : null}</DialogContent>
      </Dialog>
    </Surface>
  );
}

function UserRow({ user, roles, canEdit }: { user: PortalUser; roles: Role[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [devLink, setDevLink] = useState<string | null>(null);
  const status = STATUS[user.status];
  const run = (fn: () => Promise<{ ok: true; devLink?: string } | { ok: false; error: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      if (r.devLink) setDevLink(r.devLink);
    });

  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex items-center gap-3">
        <PersonAvatar id={user.userId} name={user.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {user.email} · {user.roleName}
            {user.status === "invited" && user.lastSentAt ? (
              <>
                {" "}
                · invited <RelativeTime iso={user.lastSentAt} />
              </>
            ) : null}
          </p>
        </div>
        <ToneChip tone={status.tone}>{status.label}</ToneChip>
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Manage ${user.name}`} disabled={pending}>
                {pending ? <Spinner /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {user.status === "invited" ? (
                <DropdownMenuItem onSelect={() => run(() => resendPortalUserInvite(user.membershipId), `Invitation sent again to ${user.email}`)}>
                  <Send /> Send the invitation again
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuLabel className="text-xs text-muted-foreground">Portal role</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={user.roleId}
                onValueChange={(roleId) => roleId !== user.roleId && run(() => setPortalUserAccess(user.membershipId, { roleId }), "Role changed")}
              >
                {roles.map((r) => (
                  <DropdownMenuRadioItem key={r.id} value={r.id}>
                    {r.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {user.status === "suspended" ? (
                <DropdownMenuItem onSelect={() => run(() => setPortalUserAccess(user.membershipId, { status: "active" }), "Access restored")}>
                  <RotateCcw /> Restore access
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem variant="destructive" onSelect={() => run(() => setPortalUserAccess(user.membershipId, { status: "suspended" }), "Access suspended")}>
                  <ShieldOff /> Suspend access
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {devLink ? <InviteLinkNotice url={devLink} /> : null}
    </li>
  );
}

function InviteForm({ clientId, clientName, roles, onDone }: { clientId: string; clientName: string; roles: Role[]; onDone: () => void }) {
  const [v, setV] = useState({ fullName: "", email: "", roleId: roles.find((r) => r.key === "client_admin")?.id ?? roles[0]?.id ?? "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [pending, start] = useTransition();
  const role = roles.find((r) => r.id === v.roleId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await invitePortalUser(clientId, v);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.fieldErrors ? null : r.error);
        return;
      }
      toast.success(`Invitation sent to ${v.email}`);
      setSent({ devLink: r.devLink });
    });
  };

  if (sent) {
    return (
      <div className="space-y-5">
        <DialogHeader>
          <DialogTitle>Invitation sent</DialogTitle>
          <DialogDescription>
            {v.fullName} gets an email to set a password for {clientName}&apos;s portal.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <MailCheck />
          <AlertTitle>Link valid for 24 hours</AlertTitle>
          <AlertDescription>You can send it again from this list at any time.</AlertDescription>
        </Alert>
        {sent.devLink ? <InviteLinkNotice url={sent.devLink} /> : null}
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader className="mb-5">
        <DialogTitle>Invite to the portal</DialogTitle>
        <DialogDescription>Someone at {clientName}. They see only their company&apos;s cases.</DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending}>
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <TextField name="fullName" label="Full name" value={v.fullName} autoFocus onChange={(e) => setV({ ...v, fullName: e.target.value })} errors={errors.fullName} />
          <TextField name="email" label="Work email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} errors={errors.email} />
          <Field data-invalid={Boolean(errors.roleId) || undefined}>
            <FieldLabel htmlFor="portal-role">Portal role</FieldLabel>
            <Select value={v.roleId} onValueChange={(roleId) => setV({ ...v, roleId })}>
              <SelectTrigger id="portal-role" className="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role ? <p className="text-xs text-muted-foreground">{role.description}</p> : null}
            <FieldError errors={errors.roleId?.map((message) => ({ message }))} />
          </Field>
        </FieldGroup>
      </fieldset>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  );
}
