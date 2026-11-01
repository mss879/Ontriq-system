"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, Ban, Check, Download, ExternalLink, FileImage, FileSearch, FileText, Lock, MailQuestion, MoreHorizontal, RefreshCw, Sparkles, Unlink, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { confirmRequirementFiles, refileDocument, removeRequirementFile, requestDocument, reviewDocument, setDocumentOriginal, setDocumentRecord, setDocumentVisibility, waiveRequirement } from "../../actions";
import { decideSuggestion } from "../ai-actions";
import { canTakeFile, pagesLabel, slotOffers, type DocumentPart } from "@/domain/documents/combined";
import type { RecordOption } from "@/domain/check-types/records";
import type { CaseDocument, OriginalKind, Requirement } from "@/lib/server/cases/queries";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { ToneChip } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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

/**
 * What a person can do here. `details` is the original-or-copy and row controls.
 * `toReport` is Post-QC putting a file in the report, without the rest of visibility.
 */
export type DocPerms = { upload: boolean; details: boolean; review: boolean; waive: boolean; request: boolean; visibility: boolean; toReport: boolean };

/** What a candidate can send (public.candidate_providable). The rest comes from Ontriq's own work. */
const CANDIDATE_CAN_PROVIDE = (category: string) => !["field_verification", "sanction_report", "consent_form", "verification_response", "reference_form"].includes(category);

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
const ORIGINAL_LABEL: Record<OriginalKind, string> = { unknown: "Copy or original?", original: "Original", certified_copy: "Certified copy", copy: "Copy" };

export function DocumentsPanel({
  caseId,
  checkId,
  requirements,
  documents,
  categories,
  checks,
  fixedCategories = [],
  records = [],
  recordsByCheck = {},
  perms,
  closed: isClosed,
  erased = false,
  consentDocumentId = null,
  locked = null,
  uploadsOpen,
  candidateCollected,
  ai,
  canDismissAi = false,
}: {
  caseId: string;
  /** Show only this check's requirements and files (check page). */
  checkId?: string;
  requirements: Requirement[];
  documents: CaseDocument[];
  categories: { key: string; name: string; guide: string; sensitive?: boolean }[];
  checks: { id: string; label: string }[];
  /** Categories that go in the report on their own (the Global Sanction report). */
  fixedCategories?: string[];
  /** The check's employers or referees, so a file can be tied to one. */
  records?: RecordOption[];
  /** The same, for every check on the case (case page). */
  recordsByCheck?: Record<string, RecordOption[]>;
  perms: DocPerms;
  closed: boolean;
  /** The files are gone. The rows stay as the record of what there was. */
  erased?: boolean;
  /** The file the candidate's consent rests on. It's reviewed as consent, in the Candidate section. */
  consentDocumentId?: string | null;
  /** Why nothing here can change right now: the case is held, or the report is with the approver. */
  locked?: string | null;
  /** The client and candidate can still send files. */
  uploadsOpen: boolean;
  /** The candidate provides the documents, so requests are theirs. */
  candidateCollected: boolean;
  /** What the AI classifier made of each file, by document id. */
  ai?: Record<string, DocumentAi>;
  canDismissAi?: boolean;
}) {
  const [upload, setUpload] = useState<UploadTarget | null>(null);
  const [requesting, setRequesting] = useState(false);
  const closed = isClosed || Boolean(locked);
  const rowsOf = (id: string | null) => (id ? (recordsByCheck[id] ?? (id === checkId ? records : [])) : []);
  const catName = (key: string) => categories.find((c) => c.key === key)?.name ?? key.replace(/_/g, " ");
  const checkLabel = (id: string | null) => (id ? (checks.find((c) => c.id === id)?.label ?? "Check") : "Case");

  const reqs = checkId ? requirements.filter((r) => r.caseCheckId === checkId) : requirements;
  const docs = checkId
    ? documents.filter((d) => d.caseCheckId === checkId || (d.caseCheckId === null && reqs.some((r) => r.category === d.category)) || reqs.some((r) => r.files.some((f) => f.documentId === d.id) || ai?.[d.id]?.contains.some((p) => p.category === r.category)))
    : documents;
  const inUse = docs.filter((d) => d.status === "uploaded" || d.status === "accepted");
  // Offered across the whole case: one decision settles the file's list, wherever it is opened from.
  const offers = perms.review && !closed
    ? inUse.flatMap((doc) => {
        const list = slotOffers(ai?.[doc.id]?.contains ?? [], requirements, doc.id, fixedCategories);
        const suggestionId = ai?.[doc.id]?.containsSuggestionId;
        return suggestionId && list.length && (!checkId || list.some((o) => o.requirement.caseCheckId === checkId)) ? [{ doc, suggestionId, list }] : [];
      })
    : [];

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

      {locked ? <p className="rounded-xl bg-muted/60 px-3.5 py-2.5 text-sm text-muted-foreground">{locked}</p> : null}

      {offers.map((o) => (
        <FileOffer key={o.doc.id} offer={o} checkLabel={checkLabel} categories={categories} rowsOf={rowsOf} />
      ))}

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
                    perms={{ ...perms, request: perms.request && !(candidateCollected && !CANDIDATE_CAN_PROVIDE(r.category)) }}
                    closed={closed}
                    candidateCollected={candidateCollected}
                    // A file can cover the other rows of a slot that already counts as received.
                    takesFile={(canTakeFile(r, fixedCategories) || (rowsOf(r.caseCheckId).length > 1 && !fixedCategories.includes(r.category))) && inUse.some((d) => !r.files.some((f) => f.documentId === d.id))}
                    files={inUse}
                    rows={rowsOf(r.caseCheckId)}
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
        {records.length && docs.length ? <RecordsWithoutFiles records={records} docs={docs} requirements={reqs} /> : null}
        {docs.length ? (
          <ul className="divide-y rounded-xl border">
            {docs.map((d) => (
              <FileRow
                key={d.id}
                d={d}
                categoryName={catName(d.category)}
                checkName={d.caseCheckId ? checkLabel(d.caseCheckId) : null}
                fixed={fixedCategories.includes(d.category)}
                holds={requirements.flatMap((r) => r.files.filter((f) => f.documentId === d.id).map((f) => [r.label, pagesLabel(f.pages)].filter(Boolean).join(", ")))}
                records={d.caseCheckId ? rowsOf(d.caseCheckId) : records}
                perms={perms}
                closed={closed}
                erased={erased}
                consentFile={d.id === consentDocumentId || (d.category === "consent_form" && d.uploadedByKind === "candidate")}
                uploadsOpen={uploadsOpen}
                categories={categories}
                checks={checks}
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

      <UploadDialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)} caseId={caseId} target={upload ?? {}} categories={categories} checks={checks} records={perms.details ? records : []} />
      <RequestDialog open={requesting} onOpenChange={setRequesting} caseId={caseId} checkId={checkId} categories={candidateCollected ? categories.filter((c) => CANDIDATE_CAN_PROVIDE(c.key)) : categories} checks={checks} candidateCollected={candidateCollected} />
    </div>
  );
}

/** One file can sit on the check as a whole, but each employer or referee should have its own (spec 4.2). */
function RecordsWithoutFiles({ records, docs, requirements }: { records: RecordOption[]; docs: CaseDocument[]; requirements: Requirement[] }) {
  const live = (id: string) => docs.some((d) => d.id === id && d.status !== "superseded" && d.status !== "rejected");
  const without = records.filter((r) => !docs.some((d) => d.recordKey === r.key && live(d.id)) && !requirements.some((q) => q.files.some((f) => f.recordKeys.includes(r.key) && live(f.documentId))));
  if (!without.length) return null;
  return <p className="mb-2 text-xs text-warning-foreground dark:text-warning">No file tied to: {without.map((r) => r.label).join(", ")}.</p>;
}

type Offer = { doc: CaseDocument; suggestionId: string; list: { requirement: Requirement; part: DocumentPart }[] };

/** The AI thinks a file holds documents the case is waiting for. A person looks, then says which. */
function FileOffer({ offer, checkLabel, categories, rowsOf }: { offer: Offer; checkLabel: (id: string | null) => string; categories: { key: string; name: string; sensitive?: boolean }[]; rowsOf: (id: string | null) => RecordOption[] }) {
  const [open, setOpen] = useState(false);
  const { doc, list } = offer;
  const names = [...new Set(list.map((o) => o.requirement.label))];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-brand-blue/5 px-3.5 py-3 ring-1 ring-brand-blue/15 dark:bg-brand-sky/10 dark:ring-brand-sky/20">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue dark:bg-brand-sky/10 dark:text-brand-sky">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {doc.label || doc.filename} may hold {list.length === 1 ? "a document" : `${list.length} documents`} this case needs
        </p>
        <p className="text-xs text-muted-foreground">{names.join(", ")}</p>
      </div>
      <Button size="sm" onClick={() => setOpen(true)}>
        Review
      </Button>
      {open ? <FileOfferDialog offer={offer} checkLabel={checkLabel} categories={categories} rowsOf={rowsOf} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function FileOfferDialog({ offer, checkLabel, categories, rowsOf, onClose }: { offer: Offer; checkLabel: (id: string | null) => string; categories: { key: string; name: string; sensitive?: boolean }[]; rowsOf: (id: string | null) => RecordOption[]; onClose: () => void }) {
  const { doc, suggestionId, list } = offer;
  const [chosen, setChosen] = useState(() => new Set(list.map((o) => o.requirement.id)));
  const [pages, setPages] = useState<Record<string, string>>(() => Object.fromEntries(list.map((o) => [o.requirement.id, o.part.pages ?? ""])));
  const [covers, setCovers] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const picked = list.filter((o) => chosen.has(o.requirement.id));
  const sensitive = !doc.sensitive && picked.some((o) => categories.find((c) => c.key === o.requirement.category)?.sensitive);

  const confirm = () =>
    start(async () => {
      const links = picked.map((o) => ({ requirement: o.requirement.id, pages: pages[o.requirement.id].trim() || null, records: covers[o.requirement.id] ?? [] }));
      const r = await confirmRequirementFiles({ documentId: doc.id, links, suggestionId, all: picked.length === list.length });
      if (!r.ok) return void toast.error(r.error);
      toast.success(picked.length === 1 ? "1 document marked as received" : `${picked.length} documents marked as received`);
      onClose();
    });
  const none = () =>
    start(async () => {
      const r = await decideSuggestion(suggestionId, "rejected");
      if (!r.ok) return void toast.error(r.error);
      toast.success("Suggestion dismissed");
      onClose();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What&apos;s in this file?</DialogTitle>
          <DialogDescription>
            The AI suggested these. Open{" "}
            <a href={`/api/files/${doc.id}`} target="_blank" rel="noopener" className="font-medium text-foreground underline underline-offset-2">
              {doc.label || doc.filename}
            </a>{" "}
            and tick what is really there. Each one you tick counts as received from this file.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-xl border">
          {list.map(({ requirement: r, part }) => (
            <li key={r.id} className="flex items-start gap-3 px-3.5 py-3">
              <Checkbox
                id={`offer-${r.id}`}
                className="mt-0.5"
                checked={chosen.has(r.id)}
                onCheckedChange={(on) =>
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(r.id);
                    else next.delete(r.id);
                    return next;
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={`offer-${r.id}`} className="block">
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{[checkLabel(r.caseCheckId), part.name].filter(Boolean).join(" · ")}</span>
                </label>
                <RowsCovered rows={rowsOf(r.caseCheckId)} value={covers[r.id] ?? []} onChange={(list) => setCovers((prev) => ({ ...prev, [r.id]: list }))} />
              </div>
              <Input
                aria-label={`Pages for ${r.label}`}
                className="h-7 w-20 text-xs"
                placeholder="Pages"
                value={pages[r.id]}
                onChange={(e) => setPages((prev) => ({ ...prev, [r.id]: e.target.value }))}
              />
            </li>
          ))}
        </ul>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>The whole file goes in the report once, with a cover page listing what it holds.</p>
          {sensitive ? <p className="text-warning-foreground dark:text-warning">It holds sensitive evidence, so only people allowed to open sensitive files will be able to open it.</p> : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={none} disabled={pending}>
            None of these
          </Button>
          <Button onClick={confirm} disabled={pending || picked.length === 0}>
            {pending ? <Spinner /> : <Check />} Confirm {picked.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Which employers or referees a combined file covers. Each needs its own evidence (spec 4.2), so a person says. */
function RowsCovered({ rows, value, onChange }: { rows: RecordOption[]; value: string[]; onChange: (keys: string[]) => void }) {
  if (rows.length < 2) return null;
  return (
    <fieldset className="mt-1.5 space-y-1">
      <legend className="text-xs text-muted-foreground">Which of these does it cover?</legend>
      {rows.map((row) => (
        <label key={row.key} className="flex items-center gap-2 text-xs">
          <Checkbox checked={value.includes(row.key)} onCheckedChange={(on) => onChange(on === true ? [...value, row.key] : value.filter((k) => k !== row.key))} />
          {row.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Without the AI, or when it missed one: a person points a slot at a file already on the case. */
function FileLinkDialog({ r, files, rows, onClose }: { r: Requirement; files: CaseDocument[]; rows: RecordOption[]; onClose: () => void }) {
  const choices = files.filter((d) => !r.files.some((f) => f.documentId === d.id));
  const [documentId, setDocumentId] = useState(choices[0]?.id ?? "");
  const [pages, setPages] = useState("");
  const [covers, setCovers] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const result = await confirmRequirementFiles({ documentId, links: [{ requirement: r.id, pages: pages.trim() || null, records: covers }], suggestionId: null, all: true });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Marked as received");
      onClose();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{r.label}: in a file already here</DialogTitle>
          <DialogDescription>Choose the file that holds it. It counts as received from that file, and you can undo this.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`link-file-${r.id}`}>
              File
            </label>
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger id={`link-file-${r.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label || d.filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`link-pages-${r.id}`}>
              Pages
            </label>
            <Input id={`link-pages-${r.id}`} value={pages} onChange={(e) => setPages(e.target.value)} placeholder="3-4" />
          </div>
        </div>
        <RowsCovered rows={rows} value={covers} onChange={setCovers} />
        <DialogFooter>
          <Button onClick={save} disabled={pending || !documentId}>
            {pending ? <Spinner /> : <Check />} Mark as received
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequirementRow({ caseId, r, perms, closed, candidateCollected, takesFile, files, rows, onUpload }: { caseId: string; r: Requirement; perms: DocPerms; closed: boolean; candidateCollected: boolean; takesFile: boolean; files: CaseDocument[]; rows: RecordOption[]; onUpload: () => void }) {
  const status = REQ_STATUS[r.status];
  const [menu, setMenu] = useState<"request" | "waive" | "file" | null>(null);
  const [pending, start] = useTransition();
  const unlink = (documentId: string) =>
    start(async () => {
      const result = await removeRequirementFile(r.id, documentId);
      if (result.ok) toast.success("Removed from this slot");
      else toast.error(result.error);
    });
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{r.label}</p>
        <p className="text-xs text-muted-foreground">
          {r.status === "waived"
            ? `Waived: ${r.waivedReason ?? ""}`
            : r.requestedNote
              ? `Requested: ${r.requestedNote}`
              : r.description ?? (r.status === "optional" ? "Optional" : r.stage === "verification" ? "Needed before Post-QC" : "Needed before Pre-QC")}
        </p>
        {r.files.length ? (
          <p className="text-xs text-muted-foreground">
            In {r.files.map((f) => [f.filename, pagesLabel(f.pages), ...f.recordKeys.map((k) => rows.find((row) => row.key === k)?.label ?? "")].filter(Boolean).join(", ")).join("; ")}
          </p>
        ) : null}
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
        {!closed && (perms.upload || perms.request || perms.waive || perms.review) ? (
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
              {perms.review && takesFile ? (
                <DropdownMenuItem onSelect={() => setMenu("file")}>
                  <FileSearch /> In a file already here
                </DropdownMenuItem>
              ) : null}
              {perms.request ? (
                <DropdownMenuItem onSelect={() => setMenu("request")}>
                  <RefreshCw /> Request again
                </DropdownMenuItem>
              ) : null}
              {perms.review
                ? r.files.map((f) => (
                    <DropdownMenuItem key={f.documentId} onSelect={() => unlink(f.documentId)} disabled={pending}>
                      <Unlink /> Not in {f.filename}
                    </DropdownMenuItem>
                  ))
                : null}
              {perms.waive && (r.status === "pending" || (r.status === "received" && rows.length > 1)) ? (
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
        description={`The ${candidateCollected ? "candidate" : "client"} will see this request and your note.`}
        label={`Note for the ${candidateCollected ? "candidate" : "client"}`}
        placeholder="e.g. Please send a clearer copy of both sides."
        required={false}
        confirmLabel="Request"
        success="Requested"
        onSubmit={async (note) => {
          const result = await requestDocument(caseId, { checkId: r.caseCheckId, category: r.category, label: r.label, note });
          if (result.ok && result.warning) toast.warning(result.warning);
          return result;
        }}
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
      {menu === "file" ? <FileLinkDialog r={r} files={files} rows={rows} onClose={() => setMenu(null)} /> : null}
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
  holds,
  records,
  perms,
  closed,
  erased,
  consentFile,
  uploadsOpen,
  categories,
  checks,
  onNewVersion,
  ai,
  typeName,
  canDismissAi,
}: {
  d: CaseDocument;
  categoryName: string;
  checkName: string | null;
  fixed: boolean;
  /** What a person confirmed this file holds, for slots other than its own. */
  holds: string[];
  records: RecordOption[];
  perms: DocPerms;
  closed: boolean;
  erased: boolean;
  /** Reviewed as consent in the Candidate section, which tells the candidate. */
  consentFile: boolean;
  uploadsOpen: boolean;
  categories: { key: string; name: string }[];
  checks: { id: string; label: string }[];
  onNewVersion: () => void;
  ai?: DocumentAi;
  typeName: (key: string) => string;
  canDismissAi: boolean;
}) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [withholding, setWithholding] = useState(false);
  const [moving, setMoving] = useState(false);
  const status = DOC_STATUS[d.status];
  const superseded = d.status === "superseded";
  const isPdf = d.mime === "application/pdf";
  // Someone outside can't replace a file once uploads have closed (public.review_document).
  const canReject = !consentFile && (uploadsOpen || (d.uploadedByKind !== "client" && d.uploadedByKind !== "candidate"));

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
  const applyVisibility = (v: string, reason?: string) =>
    start(async () => {
      const r = await setDocumentVisibility(d.id, v as CaseDocument["visibility"], reason);
      if (r.ok) toast.success(`Now: ${VISIBILITY_LABEL[v as CaseDocument["visibility"]]}`);
      else toast.error(r.error);
    });
  const changeOriginal = (kind: OriginalKind) =>
    start(async () => {
      const r = await setDocumentOriginal(d.id, kind);
      if (!r.ok) toast.error(r.error);
    });
  // Sensitive evidence never reaches a client by accident, and keeping it back is a decision too.
  const changeVisibility = (v: string) => (v === "client" && d.sensitive ? setSharing(true) : v === "internal" && d.sensitive ? setWithholding(true) : applyVisibility(v));

  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3", superseded && "opacity-60")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {isPdf ? <FileText className="size-4" /> : <FileImage className="size-4" />}
      </span>
      <div className="min-w-0 flex-[1_1_14rem]">
        {erased ? (
          <p className="truncate text-sm font-medium text-muted-foreground">File erased</p>
        ) : (
          <a href={`/api/files/${d.id}`} target="_blank" rel="noopener" className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline">
            <span className="truncate">{d.label || d.filename}</span>
            {d.sensitive ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Sensitive evidence" /> : null}
          </a>
        )}
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
        {records.length && perms.details && !superseded && !closed ? (
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
        {perms.details && !superseded && !closed ? (
          <Select value={d.originalKind} onValueChange={(v) => changeOriginal(v as OriginalKind)} disabled={pending}>
            <SelectTrigger size="sm" className="h-7 w-[8.5rem] text-xs" aria-label={`Is ${d.filename} an original or a copy`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ORIGINAL_LABEL) as OriginalKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ORIGINAL_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : d.originalKind !== "unknown" ? (
          <span className="text-xs text-muted-foreground">{ORIGINAL_LABEL[d.originalKind]}</span>
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
        ) : perms.toReport && d.visibility === "internal" && !d.withheldReason && !superseded && !closed ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyVisibility("report")} disabled={pending}>
            Put in the report
          </Button>
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
        {erased ? null : (
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
                  {canReject ? (
                    <DropdownMenuItem onSelect={() => setRejecting(true)} variant="destructive">
                      <X /> Reject
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
              {perms.review && !closed && canReject && d.status === "accepted" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setRejecting(true)} variant="destructive">
                    <X /> Reject
                  </DropdownMenuItem>
                </>
              ) : null}
              {perms.upload && !closed && d.status !== "superseded" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onNewVersion}>
                    <Upload /> Upload new version
                  </DropdownMenuItem>
                </>
              ) : null}
              {perms.review && !closed && d.status !== "superseded" && !fixed ? (
                <DropdownMenuItem onSelect={() => setMoving(true)}>
                  <ArrowRightLeft /> Move to another check or type
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {consentFile && perms.review && !closed && d.status !== "superseded" ? <p className="order-last basis-full text-xs text-muted-foreground">The signed consent form. It&apos;s reviewed in the Candidate section.</p> : null}
      {holds.length ? <p className="order-last basis-full text-xs text-muted-foreground">Holds {holds.join("; ")}</p> : null}
      {d.withheldReason ? <p className="order-last basis-full text-xs text-muted-foreground">Kept out of the report: {d.withheldReason}</p> : null}
      {d.originalKind === "unknown" && ai?.isPhotocopy ? <p className="order-last basis-full text-xs text-muted-foreground">This looks like a photocopy. Check it, then mark it above.</p> : null}
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject this file"
        description="The requirement reopens. Whoever sent the file sees your reason, so keep it plain and polite."
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
      <ReasonDialog
        open={withholding}
        onOpenChange={setWithholding}
        title="Keep this sensitive file out of the report"
        description="The check says the file exists, and Ontriq keeps it. Your reason goes in the audit trail."
        label="Why it stays out"
        placeholder="e.g. The client asked for the outcome only, not the report itself."
        maxLength={500}
        confirmLabel="Keep it out"
        success="Kept out of the report"
        onSubmit={(reason) => setDocumentVisibility(d.id, "internal", reason)}
      />
      {moving ? <MoveFileDialog d={d} categories={categories} checks={checks} onClose={() => setMoving(false)} /> : null}
    </li>
  );
}

const WHOLE_CASE = "__case__";

/** A file put in the wrong place. Its slots recount, and the move goes on the timeline. */
function MoveFileDialog({ d, categories, checks, onClose }: { d: CaseDocument; categories: { key: string; name: string }[]; checks: { id: string; label: string }[]; onClose: () => void }) {
  const [check, setCheck] = useState(d.caseCheckId ?? WHOLE_CASE);
  const [category, setCategory] = useState(d.category);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await refileDocument(d.id, check === WHOLE_CASE ? null : check, category);
      if (!r.ok) return void toast.error(r.error);
      toast.success("File moved");
      onClose();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {d.label || d.filename}</DialogTitle>
          <DialogDescription>The file keeps its history. Any tie to one employer or referee is cleared.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`move-check-${d.id}`}>
              Belongs to
            </label>
            <Select value={check} onValueChange={setCheck}>
              <SelectTrigger id={`move-check-${d.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_CASE}>The whole case</SelectItem>
                {checks.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`move-type-${d.id}`}>
              Type of document
            </label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id={`move-type-${d.id}`} className="w-full">
                <SelectValue />
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
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending || (category === d.category && check === (d.caseCheckId ?? WHOLE_CASE))}>
            {pending ? <Spinner /> : <ArrowRightLeft />} Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RequestDialog({
  open,
  onOpenChange,
  caseId,
  checkId,
  categories,
  checks,
  candidateCollected = false,
  initial,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseId: string;
  checkId?: string;
  categories: { key: string; name: string }[];
  checks: { id: string; label: string }[];
  candidateCollected?: boolean;
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
        <RequestForm candidateCollected={candidateCollected}
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
  candidateCollected,
  initial,
  onDone,
}: {
  caseId: string;
  checkId?: string;
  categories: { key: string; name: string }[];
  checks: { id: string; label: string }[];
  candidateCollected: boolean;
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
            if (r.warning) toast.warning(r.warning);
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Request a document</DialogTitle>
        <DialogDescription>It joins the required documents. The {candidateCollected ? "candidate sees" : "client sees"} the request and your note.</DialogDescription>
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
            Note for the {candidateCollected ? "candidate" : "client"} <span className="font-normal text-muted-foreground">(optional)</span>
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
