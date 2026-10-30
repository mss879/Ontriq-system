"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { BULK_COLUMNS, BULK_MAX_ROWS, bulkTemplateCsv, validateBulk } from "@/domain/portal/bulk-core";
import type { PortalPackage, PortalTemplate } from "@/lib/server/portal/queries";
import { createBulkRequests, type BulkLineResult } from "../actions";
import { PackagePicker, PROCESS_LABEL, type PackageChoice } from "./package-picker";

/** Many candidates at once from a CSV: preview and fix, then send the valid rows. */
export function BulkRequest({ templates, packages }: { templates: PortalTemplate[]; packages: PortalPackage[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pick, setPick] = useState<PackageChoice>(() => (templates[0] ? { templateId: templates[0].id, packageId: templates[0].package_id } : { packageId: packages[0]?.id }));
  const [processType, setProcessType] = useState<"client_supplied" | "candidate_collected">(templates[0]?.process_type ?? packages[0]?.default_process_type ?? "client_supplied");
  const [results, setResults] = useState<BulkLineResult[] | null>(null);
  const [pending, start] = useTransition();
  const check = useMemo(() => (file ? validateBulk(file.text) : null), [file]);
  const valid = check ? check.rows.filter((r) => !r.errors.length).length : 0;

  function onPick(p: PackageChoice) {
    setPick(p);
    const t = p.templateId ? templates.find((x) => x.id === p.templateId) : null;
    const pkg = packages.find((x) => x.id === p.packageId);
    setProcessType(t?.process_type ?? pkg?.default_process_type ?? "client_supplied");
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 512 * 1024) {
      toast.error("That file is too large. Split it into files of up to 100 candidates.");
      return;
    }
    if (/\.xlsx?$/i.test(f.name)) {
      toast.error("Save the spreadsheet as CSV first", { description: "In Excel: File → Save As → CSV UTF-8." });
      return;
    }
    setResults(null);
    setFile({ name: f.name, text: await f.text() });
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([bulkTemplateCsv()], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "ontriq-bulk-request.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  function send() {
    if (!file || !pick.packageId) return;
    start(async () => {
      const r = await createBulkRequests({ csv: file.text, packageId: pick.packageId!, templateId: pick.templateId ?? "", processType });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setResults(r.results);
      toast.success(`${r.created} ${r.created === 1 ? "request" : "requests"} sent to Ontriq`);
    });
  }

  if (results) {
    const ok = results.filter((r) => r.ok);
    return (
      <section className="space-y-4 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/12 text-success">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold">
              {ok.length} of {results.length} sent
            </h2>
            <p className="text-sm text-muted-foreground">Each request starts at “Request received” until Ontriq confirms it.</p>
          </div>
        </div>
        <ul className="divide-y rounded-xl ring-1 ring-foreground/[0.07]">
          {results.map((r) => (
            <li key={r.line} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">Line {r.line}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.name || "—"}</span>
                {r.ok ? (
                  <Link href={`/portal/cases/${r.caseId}`} className="ml-2 font-mono text-xs text-primary hover:underline">
                    {r.reference}
                  </Link>
                ) : (
                  <span className="block text-xs text-destructive">{r.error}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => { setResults(null); setFile(null); }}>
            <RotateCcw /> Another file
          </Button>
          <Button asChild>
            <Link href="/portal/cases">All cases</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
            <FileSpreadsheet className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">Upload a spreadsheet</h2>
            <p className="text-sm text-muted-foreground">
              A CSV with one candidate per row, up to {BULK_MAX_ROWS}. Columns: {BULK_COLUMNS.map((c) => c.label).join(", ")}. Only Full name is required.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download /> Template
            </Button>
            <Button variant={file ? "outline" : "default"} onClick={() => input.current?.click()}>
              <FileSpreadsheet /> {file ? "Choose another" : "Choose CSV"}
            </Button>
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </div>
      </section>

      {check ? (
        <section className="space-y-4 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">{file?.name}</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{valid}</span> ready · {check.rows.length - valid} need fixing
            </p>
          </div>
          {check.missingColumns.length ? (
            <p className="flex items-center gap-2 rounded-xl bg-destructive/8 px-3 py-2.5 text-sm text-destructive ring-1 ring-destructive/20">
              <AlertTriangle className="size-4 shrink-0" /> The file needs a {check.missingColumns.join(", ")} column. Download the template to see the layout.
            </p>
          ) : null}
          {check.tooMany ? (
            <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm ring-1 ring-warning/25">
              <AlertTriangle className="size-4 shrink-0 text-warning-foreground dark:text-warning" /> Only the first {BULK_MAX_ROWS} rows will be sent. Put the rest in another file.
            </p>
          ) : null}
          <div className="max-h-[26rem] overflow-auto rounded-xl ring-1 ring-foreground/[0.07]">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="sticky top-0 bg-muted/90 text-left text-[11px] tracking-wider text-muted-foreground uppercase backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-semibold">Line</th>
                  <th className="px-3 py-2 font-semibold">Candidate</th>
                  <th className="px-3 py-2 font-semibold">NIC</th>
                  <th className="px-3 py-2 font-semibold">Contact</th>
                  <th className="px-3 py-2 font-semibold">Position</th>
                  <th className="px-3 py-2 font-semibold">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {check.rows.map((r) => (
                  <tr key={r.line} className={cn(r.errors.length && "bg-destructive/[0.04]")}>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground tabular-nums">{r.line}</td>
                    <td className="px-3 py-2 align-top font-medium">{r.values.full_name || "—"}</td>
                    <td className="px-3 py-2 align-top font-mono text-xs">{r.values.nic || "—"}</td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">{[r.values.email, r.values.phone].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">{r.values.position_title || "—"}</td>
                    <td className="px-3 py-2 align-top text-xs">
                      {r.errors.length ? (
                        <span className="text-destructive">{r.errors.join(" ")}</span>
                      ) : r.warnings.length ? (
                        <span className="text-muted-foreground">{r.warnings.join(" ")}</span>
                      ) : (
                        <span className="text-success">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-5 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
        <div className="space-y-0.5">
          <h2 className="font-display text-lg font-semibold">Checks for everyone in the file</h2>
          <p className="text-sm text-muted-foreground">Every candidate gets the same template or package.</p>
        </div>
        <PackagePicker templates={templates} packages={packages} value={pick} onPick={onPick} />
        <Field>
          <FieldLabel>Who provides the documents?</FieldLabel>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who provides the documents">
            {(["client_supplied", "candidate_collected"] as const).map((pt) => (
              <button
                key={pt}
                type="button"
                role="radio"
                aria-checked={processType === pt}
                onClick={() => setProcessType(pt)}
                className={cn("rounded-lg px-3 py-2 text-sm ring-1 ring-foreground/[0.1] transition", processType === pt && "bg-brand-orange/[0.05] font-medium ring-2 ring-brand-orange")}
              >
                {PROCESS_LABEL[pt]}
              </button>
            ))}
          </div>
          {processType === "candidate_collected" ? <FieldDescription>Rows need an email or mobile number so Ontriq can reach the candidate.</FieldDescription> : null}
        </Field>
      </section>

      <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-2xl bg-card/95 p-4 shadow-lift ring-1 ring-foreground/[0.08] backdrop-blur">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {check ? (
            <>
              <span className="font-semibold text-foreground">{Math.min(valid, BULK_MAX_ROWS)}</span> {valid === 1 ? "candidate" : "candidates"} will be sent
            </>
          ) : (
            "Choose a CSV file to preview it."
          )}
        </p>
        <Button size="lg" className="h-10 shrink-0 px-5" onClick={send} disabled={pending || !check || !valid || Boolean(check?.missingColumns.length) || !pick.packageId}>
          {pending ? <Spinner /> : <Send />} Send {valid ? Math.min(valid, BULK_MAX_ROWS) : ""} requests
        </Button>
      </div>
    </div>
  );
}
