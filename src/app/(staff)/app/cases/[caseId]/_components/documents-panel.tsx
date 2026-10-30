"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Download, ExternalLink, FileImage, FileText, Lock, MailQuestion, MoreHorizontal, RefreshCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { requestDocument, reviewDocument, setDocumentVisibility, waiveRequirement } from "../../actions";
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
import { ReasonDialog } from "./reason-dialog";
import { UploadDialog, type UploadTarget } from "./uploader";
import type { Tone } from "@/domain/workflow/stages";

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

const VISIBILITY_LABEL = { internal: "Internal only", client: "Client can see", report: "In the report" } as const;

export function DocumentsPanel({
  caseId,
  checkId,
  requirements,
  documents,
  categories,
  checks,
  perms,
  closed,
}: {
  caseId: string;
  /** Show only this check's requirements and files (check page). */
  checkId?: string;
  requirements: Requirement[];
  documents: CaseDocument[];
  categories: { key: string; name: string; guide: string }[];
  checks: { id: string; label: string }[];
  perms: DocPerms;
  closed: boolean;
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
        {docs.length ? (
          <ul className="divide-y rounded-xl border">
            {docs.map((d) => (
              <FileRow
                key={d.id}
                d={d}
                categoryName={catName(d.category)}
                checkName={d.caseCheckId ? checkLabel(d.caseCheckId) : null}
                perms={perms}
                closed={closed}
                onNewVersion={() => setUpload({ category: d.category, checkId: d.caseCheckId, parentId: d.id, parentName: d.filename })}
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

      <UploadDialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)} caseId={caseId} target={upload ?? {}} categories={categories} checks={checks} />
      <RequestDialog open={requesting} onOpenChange={setRequesting} caseId={caseId} checkId={checkId} categories={categories} checks={checks} />
    </div>
  );
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
  perms,
  closed,
  onNewVersion,
}: {
  d: CaseDocument;
  categoryName: string;
  checkName: string | null;
  perms: DocPerms;
  closed: boolean;
  onNewVersion: () => void;
}) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const status = DOC_STATUS[d.status];
  const superseded = d.status === "superseded";
  const isPdf = d.mime === "application/pdf";

  const accept = () =>
    start(async () => {
      const r = await reviewDocument(d.id, true);
      if (r.ok) toast.success("Accepted");
      else toast.error(r.error);
    });
  const changeVisibility = (v: string) =>
    start(async () => {
      const r = await setDocumentVisibility(d.id, v as CaseDocument["visibility"]);
      if (r.ok) toast.success(`Now: ${VISIBILITY_LABEL[v as CaseDocument["visibility"]]}`);
      else toast.error(r.error);
    });

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
        <ToneChip tone={status.tone}>{status.label}</ToneChip>
        {perms.visibility && !superseded && !closed ? (
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
    </li>
  );
}

function RequestDialog({
  open,
  onOpenChange,
  caseId,
  checkId,
  categories,
  checks,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseId: string;
  checkId?: string;
  categories: { key: string; name: string }[];
  checks: { id: string; label: string }[];
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
          onDone={() => {
            onOpenChange(false);
            setFormKey((k) => k + 1);
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
  onDone,
}: {
  caseId: string;
  checkId?: string;
  categories: { key: string; name: string }[];
  checks: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [category, setCategory] = useState("");
  const [target, setTarget] = useState<string>(checkId ?? "__case__");
  const [note, setNote] = useState("");
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
