"use client";

import { useState, useTransition } from "react";
import { Mail, MoreHorizontal, Pencil, Phone, Star, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { deleteContact, saveContact } from "../actions";
import type { ClientContact } from "@/lib/server/admin/clients";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { PersonAvatar } from "@/components/cases/person";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Draft = { id?: string; name: string; title: string; email: string; phone: string; isPrimary: boolean; receivesReports: boolean; receivesInvoices: boolean };
const blank: Draft = { name: "", title: "", email: "", phone: "", isPrimary: false, receivesReports: true, receivesInvoices: false };

export function ContactsCard({ clientId, contacts, canEdit }: { clientId: string; contacts: ClientContact[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [pending, start] = useTransition();
  const [removing, setRemoving] = useState<ClientContact | null>(null);

  const remove = (c: ClientContact) =>
    start(async () => {
      const r = await deleteContact(c.id);
      if (r.ok) toast.success(`${c.name} removed`);
      else toast.error(r.error);
    });

  return (
    <Surface>
      <SurfaceHeader
        title="Contacts"
        description="Who Ontriq talks to. The primary contact receives reports by default."
        aside={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setEditing({ ...blank, isPrimary: contacts.length === 0 })}>
              <UserPlus /> Add contact
            </Button>
          ) : null
        }
      />
      {contacts.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No contacts yet.</p>
      ) : (
        <ul className="divide-y">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
              <PersonAvatar id={c.id} name={c.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{c.name}</p>
                  {c.isPrimary ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-orange/10 px-2 py-0.5 text-[11px] font-medium text-brand-orange-ink ring-1 ring-brand-orange/20">
                      <Star className="size-3" /> Primary
                    </span>
                  ) : null}
                </div>
                {c.title ? <p className="text-xs text-muted-foreground">{c.title}</p> : null}
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-foreground">
                      <Mail className="size-3" /> {c.email}
                    </a>
                  ) : null}
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                      <Phone className="size-3" /> {c.phone}
                    </a>
                  ) : null}
                  <span>{[c.receivesReports ? "Gets reports" : null, c.receivesInvoices ? "Gets invoices" : null].filter(Boolean).join(" · ") || "No documents"}</span>
                </div>
              </div>
              {canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`} disabled={pending}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() =>
                        setEditing({
                          id: c.id,
                          name: c.name,
                          title: c.title ?? "",
                          email: c.email ?? "",
                          phone: c.phone ?? "",
                          isPrimary: c.isPrimary,
                          receivesReports: c.receivesReports,
                          receivesInvoices: c.receivesInvoices,
                        })
                      }
                    >
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(c)}>
                      <Trash2 /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">{editing ? <ContactForm key={editing.id ?? "new"} clientId={clientId} draft={editing} onDone={() => setEditing(null)} /> : null}</DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this contact"}?`}
        description="They stop receiving reports and invoices from Ontriq."
        onConfirm={() => removing && remove(removing)}
      />
    </Surface>
  );
}

function ContactForm({ clientId, draft, onDone }: { clientId: string; draft: Draft; onDone: () => void }) {
  const [v, setV] = useState<Draft>(draft);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, value: Draft[K]) => setV((d) => ({ ...d, [k]: value }));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveContact(clientId, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            setError(r.fieldErrors ? null : r.error);
            return;
          }
          toast.success(draft.id ? "Contact saved" : `${v.name} added`);
          onDone();
        });
      }}
    >
      <DialogHeader className="mb-5">
        <DialogTitle>{draft.id ? "Edit contact" : "Add a contact"}</DialogTitle>
        <DialogDescription>Contacts get reports and invoices by email. To give someone portal access, invite them under Client portal.</DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending}>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {error ? (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <TextField name="name" label="Full name" autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} errors={errors.name} />
          <TextField name="title" label="Job title" value={v.title} onChange={(e) => set("title", e.target.value)} errors={errors.title} />
          <TextField name="email" label="Email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} errors={errors.email} />
          <TextField name="phone" label="Phone" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} errors={errors.phone} />
          <div className="space-y-2.5 sm:col-span-2">
            {(
              [
                ["isPrimary", "Primary contact"],
                ["receivesReports", "Receives verification reports"],
                ["receivesInvoices", "Receives invoices"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={v[key]} onCheckedChange={(c) => set(key, c === true)} />
                {label}
              </label>
            ))}
          </div>
        </FieldGroup>
      </fieldset>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Save contact
        </Button>
      </DialogFooter>
    </form>
  );
}
