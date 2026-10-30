"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Download, ExternalLink, FileImage, FileText, Lock, MailQuestion, MoreHorizontal, RefreshCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { requestDocument, reviewDocument, setDocumentRecord, setDocumentVisibility, waiveRequirement } from "../../actions";
import type { RecordOption } from "@/domain/check-types/records";
import type { CaseDocument, Requirement } from "@/lib/server/cases/queries";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { ToneChip } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ReasonDialog } from "./reason-dialog";
import { UploadDialog, type UploadTarget } from "./uploader";
import type { Tone } from "@/domain/workflow/stages";
import type { DocumentAi } from "@/lib/server/ai/queries";
import { DocumentAiChip } from "@/components/ai/document-ai-chip";

export type DocPerms = { upload: boolean; review: boolean; waive: boolean; request: boolean; visibility: boolean };

const REQ_STATUS: Record<Requirement["status"], { label: string; tone: Tone }> = {
  pending: { label: "Missing", tone: "warning" },
  received: { label: "Received", tone: "success" },
  waived: { label: "Waived", tone: "neutral" },
  optional: { label: "Optional", tone: "neutral" },
};

const DOC_STATUS: Record<CaseDocument["status"], { label: string; tone: Tone }> = {
  pending_upload: { label: "Uploading", tone: "neutral" },
  uploaded: { label: "To review", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Needs replacing", tone: "danger" },
  superseded: { label: "Replaced", tone: "neutral" },
};

const WHOLE_CHECK = "__check__";
const VISIBILITY_LABEL = { internal: "Internal only", client: "Client can see", report: "In the report" } as const;

export function DocumentsPanel({
  caseId,
  checkId,
  requirements,
  documents,
  categories,
  checks,
  fixedCategories = [],
  records = [],
  perms,
  closed,
  ai,
  canDismissAi = false,
}: {
  caseId: string;
  /** Show only this check's requirements and files (check page). */
  checkId?: string;
  requirements: Requirement[];
  documents: CaseDocument[];
  categories: { key: string; name: string; guide: string }[];
  checks: { id: string; label: string }[];
  /** Categories that go in the report on their own (the Global Sanction report). */
  fixedCategories?: string[];
  /** The check's employers or referees, so a file can be tied to one. */
  records?: RecordOption[];
  perms: DocPerms;
  closed: boolean;
  /** What the AI classifier made of each file, by document id. */
  ai?: Record<string, DocumentAi>;
  canDismissAi?: boolean;
}) {
  const [upload, setUpload] = useState<UploadTarget | null>(null);
  const [requesting, setRequesting] = useState(false);
  const catName = (key: string) => categories.find((c) => c.key === key)?.name ?? key.replace(/_/g, " ");
  const checkLabel = (id: string | null) => (id ? (checks.find((c) => c.id === id)?.label ?? "Check") : "Case");

  const reqs = checkId ? requirements.filter((r) => r.caseCheckId === checkId) : requirements;
  const docs = checkId ? documents.filter((d) => d.caseCheckId === checkId || (d.caseCheckId === null && reqs.some((r) => r.category === d.category))) : documents;

  const groups = new Map<string, Requirement[]>();
  for (const r of reqs) {
    const k = r.caseCheckId ?? "";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const outstanding = reqs.filter((r) => r.status === "pending").length;
  const canUpload = perms.upload && !closed;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {reqs.length === 0
            ? "No documents are required."
            : outstanding === 0
              ? "Every required document is in or waived."
              : `${outstanding} required ${outstanding === 1 ? "document is" : "documents are"} still missing.`}
        </p>
        <div className="flex gap-2">
          {perms.request && !closed ? (
            <Button variant="outline" size="sm" onClick={() => setRequesting(true)}>
              <MailQuestion /> Request
            </Button>
          ) : null}
          {canUpload ? (
            <Button size="sm" onClick={() => setUpload({ checkId: checkId ?? null })}>
              <Upload /> Upload
            </Button>
          ) : null}
        </div>
      </div>

      {groups.size ? (
        <div className="space-y-4">
          {[...groups.entries()].map(([groupId, list]) => (
            <div key={groupId || "case"}>
              {!checkId ? <p className="mb-1.5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{checkLabel(groupId || null)}</p> : null}
              <ul className="divide-y rounded-xl border">
                {list.map((r) => (
                  <RequirementRow
                    key={r.id}
                    caseId={caseId}
                    r={r}
                    perms={perms}
                    closed={closed}
                    onUpload={() => setUpload({ category: r.category, checkId: r.caseCheckId, label: r.label })}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <p className="mb-1.5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Files</p>
        {docs.length && perms.visibility ? (
          <p className="mb-2 text-xs text-muted-foreground">Clients open a file in their portal only when it says “Client can see”. “In the report” files reach them inside the released PDF. “Internal only” keeps a file out of both.</p>
        ) : null}
        {records.length && docs.length ? <RecordsWithoutFiles records={records} docs={docs} /> : null}
        {docs.length ? (
          <ul className="divide-y rounded-xl border">
            {docs.map((d) => (
              <FileRow
                key={d.id}
                d={d}
                categoryName={catName(d.category)}
                checkName={d.caseCheckId ? checkLabel(d.caseCheckId) : null}
                fixed={fixedCategories.includes(d.category)}
                records={records}
                perms={perms}
                closed={closed}
                onNewVersion={() => setUpload({ category: d.category, checkId: d.caseCheckId, parentId: d.id, parentName: d.filename, recordKey: d.recordKey })}
                ai={d.status === "superseded" ? undefined : ai?.[d.id]}
                typeName={catName}
                canDismissAi={canDismissAi && !closed}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center">
            <p className="text-sm font-medium">No files yet</p>
            <p className="mt-1 text-sm text-muted-foreground">{canUpload ? "Upload what the client or candidate sent, or request what's missing." : "Files appear here as they arrive."}</p>
          </div>
        )}
      </div>

      <UploadDialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)} caseId={caseId} target={upload ?? {}} categories={categories} checks={checks} records={records} />
      <RequestDialog open={requesting} onOpenChange={setRequesting} caseId={caseId} checkId={checkId} categories={categories} checks={checks} />
    </div>
  );
}

/** One file can sit on the check as a whole, but each employer or referee should have its own (spec 4.2). */
function RecordsWithoutFiles({ records, docs }: { records: RecordOption[]; docs: CaseDocument[] }) {
  const without = records.filter((r) => !docs.some((d) => d.recordKey === r.key && d.status !== "superseded" && d.status !== "rejected"));
  if (!without.length) return null;
  return <p className="mb-2 text-xs text-warning-foreground dark:text-warning">No file tied to: {without.map((r) => r.label).join(", ")}.</p>;
}

function RequirementRow({ caseId, r, perms, closed, onUpload }: { caseId: string; r: Requirement; perms: DocPerms; closed: boolean; onUpload: () => void }) {
  const status = REQ_STATUS[r.status];
  const [menu, setMenu] = useState<"request" | "waive" | null>(null);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{r.label}</p>
        <p className="text-xs text-muted-foreground">
          {r.status === "waived"
            ? `Waived: ${r.waivedReason ?? ""}`
            : r.requestedNote
              ? `Requested: ${r.requestedNote}`
              : r.description ?? (r.stage === "verification" ? "Needed before Post-QC" : "Needed before Pre-QC")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {r.status === "optional" ? (
          r.receivedCount ? <span className="text-xs text-muted-foreground tabular-nums">{r.receivedCount} in</span> : null
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {r.receivedCount}/{Math.max(r.minCount, r.receivedCount)}
          </span>
        )}
        <ToneChip tone={status.tone}>{status.label}</ToneChip>
        {!closed && (perms.upload || perms.request || perms.waive) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.label}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {perms.upload ? (
                <DropdownMenuItem onSelect={onUpload}>
                  <Upload /> Upload
                </DropdownMenuItem>
              ) : null}
              {perms.request ? (
                <DropdownMenuItem onSelect={() => setMenu("request")}>
                  <RefreshCw /> Request again
                </DropdownMenuItem>
              ) : null}
              {perms.waive && r.status === "pending" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setMenu("waive")}>
                    <Ban /> Waive
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <ReasonDialog
        open={menu === "request"}
        onOpenChange={(o) => setMenu(o ? "request" : null)}
        title={`Request ${r.label.toLowerCase()} again`}
        description="The client and candidate will see this request and your note."
        label="Note for the client or candidate"
        placeholder="e.g. Please send a clearer copy of both sides."
        required={false}
        confirmLabel="Request"
        success="Requested"
        onSubmit={(note) => requestDocument(caseId, { checkId: r.caseCheckId, category: r.category, label: r.label, note })}
      />
      <ReasonDialog
        open={menu === "waive"}
        onOpenChange={(o) => setMenu(o ? "waive" : null)}
        title={`Waive ${r.label.toLowerCase()}`}
        description="The case can move on without it. Your reason goes in the audit trail."
        placeholder="e.g. Client confirmed by email that it isn't needed."
        confirmLabel="Waive"
        success="Waived"
        onSubmit={(reason) => waiveRequirement(r.id, reason)}
      />
    </li>
  );
}

/** Who sent a file: candidates have no account, client users are named with their company role. */
function uploaderLabel(d: CaseDocument): string {
  if (d.uploadedByKind === "candidate") return "Candidate";
  if (d.uploadedByKind === "client") return d.uploadedBy ? `Client · ${d.uploadedBy.name}` : "Client";
  return d.uploadedBy?.name ?? "System";
}

function FileRow({
  d,
  categoryName,
  checkName,
  fixed,
  records,
  perms,
  closed,
  onNewVersion,
  ai,
  typeName,
  canDismissAi,
}: {
  d: CaseDocument;
  categoryName: string;
  checkName: string | null;
  fixed: boolean;
  records: RecordOption[];
  perms: DocPerms;
  closed: boolean;
  onNewVersion: () => void;
  ai?: DocumentAi;
  typeName: (key: string) => string;
  canDismissAi: boolean;
}) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const status = DOC_STATUS[d.status];
  const superseded = d.status === "superseded";
  const isPdf = d.mime === "application/pdf";

  const accept = () =>
    start(async () => {
      const r = await reviewDocument(d.id, true);
      if (r.ok) toast.success("Accepted");
      else toast.error(r.error);
    });
  const changeRecord = (v: string) =>
    start(async () => {
      const r = await setDocumentRecord(d.id, v === WHOLE_CHECK ? null : v);
      if (!r.ok) toast.error(r.error);
    });
  const applyVisibility = (v: string) =>
    start(async () => {
      const r = await setDocumentVisibility(d.id, v as CaseDocument["visibility"]);
      if (r.ok) toast.success(`Now: ${VISIBILITY_LABEL[v as CaseDocument["visibility"]]}`);
      else toast.error(r.error);
    });
  // Sensitive evidence never reaches a client by accident.
  const changeVisibility = (v: string) => (v === "client" && d.sensitive ? setSharing(true) : applyVisibility(v));

  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3", superseded && "opacity-60")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {isPdf ? <FileText className="size-4" /> : <FileImage className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <a href={`/api/files/${d.id}`} target="_blank" rel="noopener" className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline">
          <span className="truncate">{d.label || d.filename}</span>
          {d.sensitive ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Sensitive evidence" /> : null}
        </a>
        <p className="truncate text-xs text-muted-foreground">
          {d.label ? `${d.filename} · ` : ""}
          {categoryName}
          {checkName ? ` · ${checkName}` : ""} · v{d.version} · {formatBytes(d.sizeBytes)} · {uploaderLabel(d)}{" "}
          <RelativeTime iso={d.createdAt} />
        </p>
        {d.status === "rejected" && d.rejectionReason ? <p className="mt-0.5 text-xs text-destructive">{d.rejectionReason}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {d.uploadedByKind === "candidate" || d.uploadedByKind === "client" ? (
          <ToneChip tone="progress" dot={false} className="h-5 px-2 text-[11px]">
            From {d.uploadedByKind}
          </ToneChip>
        ) : null}
        {ai ? <DocumentAiChip ai={ai} typeName={typeName} canDismiss={canDismissAi} /> : null}
        <ToneChip tone={status.tone}>{status.label}</ToneChip>
        {records.length && perms.upload && !superseded && !closed ? (
          <Select value={d.recordKey ?? WHOLE_CHECK} onValueChange={changeRecord} disabled={pending}>
            <SelectTrigger size="sm" className="h-7 w-[10rem] text-xs" aria-label={`Which record ${d.filename} belongs to`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE_CHECK}>Whole check</SelectItem>
              {records.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {fixed && !superseded ? (
          <span className="text-xs text-muted-foreground">Always in the report</span>
        ) : perms.visibility && !superseded && !closed ? (
          <Select value={d.visibility} onValueChange={changeVisibility} disabled={pending}>
            <SelectTrigger size="sm" className="h-7 w-[8.5rem] text-xs" aria-label={`Who can see ${d.filename}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(VISIBILITY_LABEL) as CaseDocument["visibility"][]).map((v) => (
                <SelectItem key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">{VISIBILITY_LABEL[d.visibility]}</span>
        )}
        {perms.review && !closed && (d.status === "uploaded" || d.status === "rejected") ? (
          <>
            {d.status === "uploaded" ? (
              <Button variant="outline" size="sm" onClick={accept} disabled={pending}>
                <Check /> Accept
              </Button>
            ) : null}
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More for ${d.filename}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={`/api/files/${d.id}`} target="_blank" rel="noopener">
                <ExternalLink /> Open
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/api/files/${d.id}?download=1`}>
                <Download /> Download
              </a>
            </DropdownMenuItem>
            {perms.review && !closed && d.status === "uploaded" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={accept}>
                  <Check /> Accept
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRejecting(true)} variant="destructive">
                  <X /> Reject
                </DropdownMenuItem>
              </>
            ) : null}
            {perms.review && !closed && d.status === "accepted" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setRejecting(true)} variant="destructive">
                  <X /> Reject
                </DropdownMenuItem>
              </>
            ) : null}
            {perms.upload && !closed && d.status === "rejected" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onNewVersion}>
                  <Upload /> Upload new version
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject this file"
        description="The requirement reopens. The client and candidate see your reason, so keep it plain and polite."
        placeholder="e.g. The photo is blurred; we need both sides of the NIC."
        confirmLabel="Reject file"
        destructive
        success="File rejected"
        onSubmit={(reason) => reviewDocument(d.id, false, reason)}
      />
      <ConfirmDialog
        open={sharing}
        onOpenChange={setSharing}
        title="Share this sensitive file with the client?"
        description="The client can open it in their portal straight away, before the report is approved. To send it with the report instead, choose “In the report”."
        confirmLabel="Share it"
        onConfirm={() => applyVisibility("client")}
      />
    </li>
  );
}

export function RequestDialog({
  open,
  onOpenChange,
  caseId,
  checkId,
  categories,
  checks,
  initial,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseId: string;
  checkId?: string;
  categories: { key: string; name: string }[];
  checks: { id: string; label: string }[];
  /** Start with this document and note (e.g. drafted by the Pre-QC copilot). */
  initial?: { category?: string; note?: string };
  onSent?: () => void;
}) {
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setFormKey((k) => k + 1);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <RequestForm
          key={formKey}
          caseId={caseId}
          checkId={checkId}
          categories={categories}
          checks={checks}
          initial={initial}
          onDone={() => {
            onOpenChange(false);
            setFormKey((k) => k + 1);
            onSent?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RequestForm({
  caseId,
  checkId,
  categories,
  checks,
  initial,
  onDone,
}: {
  caseId: string;
  checkId?: string;
  categories: { key: string; name: string }[];
  checks: { id: string; label: string }[];
  initial?: { category?: string; note?: string };
  onDone: () => void;
}) {
  const [category, setCategory] = useState(initial?.category && categories.some((c) => c.key === initial.category) ? initial.category : "");
  const [target, setTarget] = useState<string>(checkId ?? "__case__");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!category) {
          setError("Choose which document you need.");
          return;
        }
        start(async () => {
          const name = categories.find((c) => c.key === category)?.name ?? category;
          const r = await requestDocument(caseId, { checkId: target === "__case__" ? null : target, category, label: name, note });
          if (r.ok) {
            toast.success("Requested");
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Request a document</DialogTitle>
        <DialogDescription>It joins the required documents. The client and candidate see the request and your note.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="request-category">
              Document
            </label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="request-category" className="w-full">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="request-check">
              For
            </label>
            <Select value={target} onValueChange={setTarget} disabled={Boolean(checkId)}>
              <SelectTrigger id="request-check" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__case__">The whole case</SelectItem>
                {checks.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="request-note">
            Note for the client or candidate <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea id="request-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Please send the service letter from your previous employer." />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <MailQuestion />} Request
        </Button>
      </DialogFooter>
    </form>
  );
}
