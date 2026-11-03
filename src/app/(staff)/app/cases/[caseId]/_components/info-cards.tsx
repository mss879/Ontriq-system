"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { setCaseClientVisible, updateCandidate, updateCaseDetails } from "../../actions";
import type { CaseDetail } from "@/lib/server/cases/queries";
import { formatDate, formatPlainDate } from "@/lib/format";
import { parseNic } from "@/domain/nic-core";
import { DISTRICT_CHOICES } from "@/domain/districts";
import { PRIORITY_LABELS, PROCESS_TYPE_LABELS, type Priority } from "@/domain/workflow/stages";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { SURFACE } from "@/components/admin/surface";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/forms/date-field";

const LANGUAGES = { en: "English", si: "Sinhala", ta: "Tamil" } as const;
const NO_DISTRICT = "__none__";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function CardShell({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <section className={cn(SURFACE, "p-5")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {onEdit ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : null}
      </div>
      <dl className="divide-y">{children}</dl>
    </section>
  );
}

function FieldBlock({ id, label, error, children, hint }: { id: string; label: string; error?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- candidate

export function CandidateCard({ candidate, canEdit }: { candidate: CaseDetail["candidate"]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <CardShell title="Candidate" onEdit={canEdit ? () => setOpen(true) : undefined}>
        <Row label="Name">{candidate.fullName}</Row>
        <Row label="NIC">
          {candidate.nic ? (
            <span>
              <span className="font-mono tracking-wide">{candidate.nic}</span>
              {candidate.dateOfBirth ? (
                <span className="block text-xs text-muted-foreground">
                  Born {formatPlainDate(candidate.dateOfBirth)}
                  {candidate.gender ? ` · ${candidate.gender}` : ""}
                </span>
              ) : null}
            </span>
          ) : null}
        </Row>
        <Row label="Email">{candidate.email ? <a className="hover:underline" href={`mailto:${candidate.email}`}>{candidate.email}</a> : null}</Row>
        <Row label="Phone">{candidate.phone ? <a className="hover:underline" href={`tel:${candidate.phone.replace(/\s+/g, "")}`}>{candidate.phone}</a> : null}</Row>
        <Row label="Address">{candidate.address}</Row>
        <Row label="District">{candidate.district}</Row>
        <Row label="Language">{LANGUAGES[candidate.preferredLanguage as keyof typeof LANGUAGES] ?? candidate.preferredLanguage}</Row>
      </CardShell>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setFormKey((k) => k + 1);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <CandidateForm
            key={formKey}
            candidate={candidate}
            onDone={() => {
              setOpen(false);
              setFormKey((k) => k + 1);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CandidateForm({ candidate, onDone }: { candidate: CaseDetail["candidate"]; onDone: () => void }) {
  const [v, setV] = useState({
    fullName: candidate.fullName,
    nic: candidate.nic ?? "",
    email: candidate.email ?? "",
    phone: candidate.phone ?? "",
    address: candidate.address ?? "",
    district: candidate.district ?? "",
    preferredLanguage: (candidate.preferredLanguage as "en" | "si" | "ta") ?? "en",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nic = v.nic.trim() ? parseNic(v.nic) : null;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          // Left unchanged, a contact stays as it is on the record, which may differ from what a client typed on this request.
          const r = await updateCandidate(candidate.id, { ...v, email: v.email === (candidate.email ?? "") ? undefined : v.email, phone: v.phone === (candidate.phone ?? "") ? undefined : v.phone });
          if (r.ok) {
            toast.success("Candidate updated");
            onDone();
          } else {
            setErrors(r.fieldErrors ?? {});
            setFormError(r.fieldErrors ? null : r.error);
          }
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Candidate details</DialogTitle>
        <DialogDescription>These details belong to the candidate and appear on every case they have.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldBlock id="cand-name" label="Full name" error={errors.fullName?.[0]}>
            <Input id="cand-name" value={v.fullName} onChange={set("fullName")} aria-invalid={Boolean(errors.fullName) || undefined} />
          </FieldBlock>
        </div>
        <FieldBlock
          id="cand-nic"
          label="NIC number"
          error={errors.nic?.[0]}
          hint={nic ? (nic.valid ? `Born ${formatPlainDate(nic.birthDate)} · ${nic.gender}` : nic.error) : undefined}
        >
          <Input id="cand-nic" value={v.nic} onChange={(e) => setV((p) => ({ ...p, nic: e.target.value.toUpperCase() }))} className="font-mono tracking-wide" autoComplete="off" />
        </FieldBlock>
        <FieldBlock id="cand-phone" label="Phone" error={errors.phone?.[0]}>
          <Input id="cand-phone" type="tel" value={v.phone} onChange={set("phone")} placeholder="077 123 4567" />
        </FieldBlock>
        <div className="sm:col-span-2">
          <FieldBlock id="cand-email" label="Email" error={errors.email?.[0]}>
            <Input id="cand-email" type="email" value={v.email} onChange={set("email")} />
          </FieldBlock>
        </div>
        <div className="sm:col-span-2">
          <FieldBlock id="cand-address" label="Address" error={errors.address?.[0]}>
            <Textarea id="cand-address" value={v.address} onChange={set("address")} rows={2} />
          </FieldBlock>
        </div>
        <FieldBlock id="cand-district" label="District" error={errors.district?.[0]}>
          <Select value={v.district || NO_DISTRICT} onValueChange={(d) => setV((p) => ({ ...p, district: d === NO_DISTRICT ? "" : d }))}>
            <SelectTrigger id="cand-district" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DISTRICT}>Not set</SelectItem>
              {DISTRICT_CHOICES.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldBlock>
        <FieldBlock id="cand-lang" label="Preferred language">
          <Select value={v.preferredLanguage} onValueChange={(l) => setV((p) => ({ ...p, preferredLanguage: l as "en" | "si" | "ta" }))}>
            <SelectTrigger id="cand-lang" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LANGUAGES).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldBlock>
      </div>
      {formError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- case details

export type DetailsView = Pick<
  CaseDetail,
  "priority" | "positionTitle" | "department" | "clientReference" | "instructions" | "internalNotes" | "receivedAt" | "dueAt" | "processType" | "createdVia" | "package" | "clientVisible"
>;

const VIA = { staff: "Ontriq staff", portal: "Client portal", import: "Bulk import", assistant: "Command assistant" } as Record<string, string>;

/** The due date shown in Colombo time as YYYY-MM-DD, for the date input. */
function colomboDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Ontriq decides whether a case shows in the client's portal (spec 6.4). */
function PortalVisibility({ caseId, visible, canHide }: { caseId: string; visible: boolean; canHide: boolean }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-wrap items-center justify-between gap-2">
      {visible ? "Shown to the client" : "Hidden from the client"}
      {canHide ? (
        <Button
          variant="ghost"
          size="sm"
          className="-my-1 h-7"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setCaseClientVisible(caseId, !visible);
              if (r.ok) toast.success(visible ? "Hidden from the client portal" : "Shown in the client portal");
              else toast.error(r.error);
            })
          }
        >
          {visible ? "Hide" : "Show"}
        </Button>
      ) : null}
    </span>
  );
}

export function DetailsCard({ caseId, details, canEdit, canSetDue, canHide }: { caseId: string; details: DetailsView; canEdit: boolean; canSetDue: boolean; canHide: boolean }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <CardShell title="Request" onEdit={canEdit ? () => setOpen(true) : undefined}>
        {/* Optional details show once they're filled; Edit adds them. */}
        {details.positionTitle ? <Row label="Position">{details.positionTitle}</Row> : null}
        {details.department ? <Row label="Department">{details.department}</Row> : null}
        {details.clientReference ? <Row label="Client ref.">{details.clientReference}</Row> : null}
        <Row label="Package">
          {details.package.name}
          {details.package.tatDays ? <span className="text-muted-foreground"> · {details.package.tatDays} working days</span> : null}
        </Row>
        <Row label="Process">{PROCESS_TYPE_LABELS[details.processType]}</Row>
        <Row label="Priority">{PRIORITY_LABELS[details.priority]}</Row>
        <Row label="Received">
          {formatDate(details.receivedAt)}
          <span className="text-muted-foreground"> · {VIA[details.createdVia] ?? details.createdVia}</span>
        </Row>
        <Row label="Due">{formatDate(details.dueAt)}</Row>
        {details.internalNotes ? <Row label="For the team">{details.internalNotes}</Row> : null}
        {details.instructions ? <Row label="From the client">{details.instructions}</Row> : null}
        <Row label="Client portal">
          <PortalVisibility caseId={caseId} visible={details.clientVisible} canHide={canHide} />
        </Row>
      </CardShell>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setFormKey((k) => k + 1);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DetailsForm
            key={formKey}
            caseId={caseId}
            details={details}
            canSetDue={canSetDue}
            onDone={() => {
              setOpen(false);
              setFormKey((k) => k + 1);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailsForm({ caseId, details, canSetDue, onDone }: { caseId: string; details: DetailsView; canSetDue: boolean; onDone: () => void }) {
  const [v, setV] = useState({
    priority: details.priority,
    positionTitle: details.positionTitle ?? "",
    department: details.department ?? "",
    clientReference: details.clientReference ?? "",
    instructions: details.instructions ?? "",
    internalNotes: details.internalNotes ?? "",
    due: colomboDate(details.dueAt),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const dueChanged = canSetDue && v.due && v.due !== colomboDate(details.dueAt);
          const r = await updateCaseDetails(caseId, {
            priority: v.priority,
            positionTitle: v.positionTitle,
            department: v.department,
            clientReference: v.clientReference,
            instructions: v.instructions,
            internalNotes: v.internalNotes,
            ...(dueChanged ? { dueAt: `${v.due}T17:30:00+05:30` } : {}),
          });
          if (r.ok) {
            toast.success("Case updated");
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Request details</DialogTitle>
        <DialogDescription>What the client asked for. Changes are recorded on the timeline.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock id="det-priority" label="Priority">
          <Select value={v.priority} onValueChange={(p) => setV((s) => ({ ...s, priority: p as Priority }))}>
            <SelectTrigger id="det-priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldBlock>
        {canSetDue ? (
          <FieldBlock id="det-due" label="Due date" hint="Due at close of business, Colombo time.">
            <DateField id="det-due" value={v.due} onChange={set("due")} />
          </FieldBlock>
        ) : (
          <div />
        )}
        <FieldBlock id="det-position" label="Position">
          <Input id="det-position" value={v.positionTitle} onChange={set("positionTitle")} />
        </FieldBlock>
        <FieldBlock id="det-dept" label="Department">
          <Input id="det-dept" value={v.department} onChange={set("department")} />
        </FieldBlock>
        <div className="sm:col-span-2">
          <FieldBlock id="det-ref" label="Client's reference">
            <Input id="det-ref" value={v.clientReference} onChange={set("clientReference")} />
          </FieldBlock>
        </div>
        <div className="sm:col-span-2">
          <FieldBlock id="det-notes" label="Instructions for the team (clients never see this)">
            <Textarea id="det-notes" value={v.internalNotes} onChange={set("internalNotes")} rows={3} />
          </FieldBlock>
        </div>
        <div className="sm:col-span-2">
          <FieldBlock id="det-instr" label="Instructions from the client (shown on their portal)">
            <Textarea id="det-instr" value={v.instructions} onChange={set("instructions")} rows={3} />
          </FieldBlock>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
