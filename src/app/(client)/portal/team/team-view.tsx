"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, RotateCw, ShieldCheck, ShieldOff, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { initials } from "@/components/layout/user-menu";
import { ToneChip } from "@/components/cases/badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { PortalTeamMember } from "@/domain/portal/types";
import { changeColleagueRole, inviteColleague, resendColleagueInvite, setColleagueStatus } from "./actions";

export type RoleOption = { id: string; key: string; name: string; description: string };

const STATUS = { active: { label: "Active", tone: "success" }, invited: { label: "Invited", tone: "info" }, suspended: { label: "Suspended", tone: "neutral" } } as const;

export function InviteButton({ roles }: { roles: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" size="lg" className="h-9 px-3.5" onClick={() => setOpen(true)}>
        <UserPlus /> Invite a colleague
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">{open ? <InviteForm roles={roles} onDone={() => setOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}

function InviteForm({ roles, onDone }: { roles: RoleOption[]; onDone: () => void }) {
  const [form, setForm] = useState({ fullName: "", email: "", roleId: roles.find((r) => r.key === "client_user")?.id ?? roles[0]?.id ?? "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const role = roles.find((r) => r.id === form.roleId);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite a colleague</DialogTitle>
        <DialogDescription>They get an email to set a password. The link works once and lasts 24 hours.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="inv-name">Full name</FieldLabel>
          <Input id="inv-name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} autoComplete="off" />
          <FieldError errors={errors.fullName?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="inv-email">Work email</FieldLabel>
          <Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} autoComplete="off" />
          <FieldError errors={errors.email?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={errors.roleId ? true : undefined}>
          <FieldLabel htmlFor="inv-role">Access</FieldLabel>
          <Select value={form.roleId} onValueChange={(v) => setForm((f) => ({ ...f, roleId: v }))}>
            <SelectTrigger id="inv-role" className="w-full">
              <SelectValue>{role?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {role?.description ? <FieldDescription>{role.description}</FieldDescription> : null}
          <FieldError errors={errors.roleId?.map((message) => ({ message }))} />
        </Field>
      </div>
      <DialogFooter>
        <Button
          variant="brand"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await inviteColleague(form);
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                toast.error(r.error);
                return;
              }
              toast.success(`Invitation sent to ${form.email}`, r.devLink ? { description: "Email isn't configured; the link was logged on the server." } : undefined);
              onDone();
            })
          }
        >
          {pending ? <Spinner /> : <UserPlus />} Send invitation
        </Button>
      </DialogFooter>
    </>
  );
}

export function TeamList({ members, roles }: { members: PortalTeamMember[]; roles: RoleOption[] }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error ?? "Something went wrong.");
    });

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <p className="text-sm font-semibold">
          {members.length} {members.length === 1 ? "person" : "people"}
        </p>
        <p className="text-xs text-muted-foreground">
          {members.filter((m) => m.status === "active").length} active · {members.filter((m) => m.status === "invited").length} invited
        </p>
      </div>
      <ul className="divide-y divide-border/70">
        {members.map((m) => {
          const s = STATUS[m.status];
          return (
            <li key={m.membership_id} className={cn("flex items-center gap-3 px-5 py-3.5", pending && "opacity-80")}>
              <Avatar className="size-9">
                <AvatarFallback className="bg-[linear-gradient(135deg,#0c5a9a,#0098f3)] text-xs font-semibold text-white">{initials(m.full_name ?? "", m.email ?? "")}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="truncate">{m.full_name || m.email}</span>
                  {m.is_me ? <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">You</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.email} · {m.role_name}
                  {m.status === "invited" && m.invited_at ? ` · invited ${formatDate(m.invited_at)}` : m.activated_at ? ` · since ${formatDate(m.activated_at)}` : ""}
                </p>
              </div>
              <ToneChip tone={s.tone} className="hidden sm:inline-flex">
                {s.label}
              </ToneChip>
              {m.is_me ? (
                <span className="size-7" />
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Manage ${m.full_name || m.email}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Access</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={m.role_id} onValueChange={(v) => run(() => changeColleagueRole(m.membership_id, v), "Access updated")}>
                      {roles.map((r) => (
                        <DropdownMenuRadioItem key={r.id} value={r.id}>
                          {r.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    {m.status === "invited" ? (
                      <DropdownMenuItem onSelect={() => run(() => resendColleagueInvite(m.membership_id), "Invitation sent again")}>
                        <RotateCw /> Send invitation again
                      </DropdownMenuItem>
                    ) : null}
                    {m.status === "suspended" ? (
                      <DropdownMenuItem onSelect={() => run(() => setColleagueStatus(m.membership_id, "active"), "Access restored")}>
                        <ShieldCheck /> Restore access
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem variant="destructive" onSelect={() => run(() => setColleagueStatus(m.membership_id, "suspended"), m.status === "invited" ? "Invitation cancelled" : "Access removed")}>
                        <ShieldOff /> {m.status === "invited" ? "Cancel invitation" : "Remove access"}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
