"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "@/components/link";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Mail, Plus, RotateCcw, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, importTemplateCsv, validateImport } from "@/domain/cases/import-core";
import { importCases, type ImportLineResult } from "./actions";
import { QuickClientDialog } from "../../clients/quick-client-dialog";

type ProcessType = "client_supplied" | "candidate_collected";
type Priority = "normal" | "high" | "urgent";
type PackageOption = { id: string; name: string; code: string; clientId: string | null; checks: number; tatDays: number; defaultProcessType: ProcessType };
type TemplateOption = { id: string; name: string; clientId: string | null; packageId: string; processType: ProcessType; priority: Priority };

const PROCESS_LABEL: Record<ProcessType, string> = { client_supplied: "The client sends them", candidate_collected: "Ontriq collects from the candidate" };
const MAX_FILE_BYTES = 1024 * 1024;
type Filter = "all" | "problems";

export function ImportCases({
  clients: loadedClients,
  canAddClient,
  packages,
  templates,
  initialClientId,
}: {
  clients: { id: string; name: string; code: string }[];
  canAddClient: boolean;
  packages: PackageOption[];
  templates: TemplateOption[];
  initialClientId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [addedClients, setAddedClients] = useState<{ id: string; name: string; code: string }[]>([]);
  const clients = useMemo(() => [...addedClients, ...loadedClients.filter((c) => !addedClients.some((a) => a.id === c.id))], [addedClients, loadedClients]);
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [setup, setSetup] = useState(""); // "t:<id>" or "p:<id>"
  const [processType, setProcessType] = useState<ProcessType>("client_supplied");
  const [priority, setPriority] = useState<Priority>("normal");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<ImportLineResult[] | null>(null);
  const [pending, start] = useTransition();

  const visibleTemplates = templates.filter((t) => !t.clientId || t.clientId === clientId);
  const visiblePackages = packages.filter((p) => !p.clientId || p.clientId === clientId);
  const template = setup.startsWith("t:") ? visibleTemplates.find((t) => t.id === setup.slice(2)) : undefined;
  const pkg = template ? packages.find((p) => p.id === template.packageId) : setup.startsWith("p:") ? visiblePackages.find((p) => p.id === setup.slice(2)) : undefined;

  const check = useMemo(() => (file ? validateImport(file.text, { processType }) : null), [file, processType]);
  const ready = check ? check.rows.filter((r) => !r.errors.length) : [];
  const problems = check ? check.rows.length - ready.length : 0;
  const shown = check ? (filter === "problems" ? check.rows.filter((r) => r.errors.length || r.warnings.length) : check.rows) : [];
  const client = clients.find((c) => c.id === clientId);
  const canImport = Boolean(client && pkg && check && ready.length && !check.missingColumns.length);

  function choose(value: string) {
    setSetup(value);
    const t = value.startsWith("t:") ? templates.find((x) => x.id === value.slice(2)) : undefined;
    const p = t ? packages.find((x) => x.id === t.packageId) : value.startsWith("p:") ? packages.find((x) => x.id === value.slice(2)) : undefined;
    setProcessType(t?.processType ?? p?.defaultProcessType ?? "client_supplied");
    if (t) setPriority(t.priority);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      toast.error("Save the spreadsheet as CSV first", { description: "In Excel: File → Save As → CSV UTF-8." });
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error(`That file is too large. Split it into files of up to ${IMPORT_MAX_ROWS} rows.`);
      return;
    }
    setResults(null);
    setFilter("all");
    setFile({ name: f.name, text: await f.text() });
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([`﻿${importTemplateCsv()}`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "ontriq-case-import.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  function run() {
    if (!canImport || !pkg) return;
    setConfirming(false);
    start(async () => {
      const r = await importCases({
        clientId,
        packageId: pkg.id,
        templateId: template?.id ?? "",
        processType,
        priority,
        records: ready.map((row) => ({ line: row.line, values: row.values as Record<string, string> })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setResults(r.results);
      if (r.failed) toast.warning(`${r.created} created, ${r.failed} couldn't be created`);
      else toast.success(`${r.created} ${r.created === 1 ? "case" : "cases"} created`);
    });
  }

  if (results) {
    const ok = results.filter((r): r is Extract<ImportLineResult, { ok: true }> => r.ok);
    const links = ok.filter((r) => r.linkSent.length).length;
    return (
      <section className="space-y-4 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", ok.length === results.length ? "bg-success/12 text-success" : "bg-warning/15 text-warning-foreground dark:text-warning")}>
            {ok.length === results.length ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold">
              {ok.length} of {results.length} {results.length === 1 ? "case" : "cases"} created for {client?.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              New cases are being assigned to the freest qualified officers now.
              {processType === "candidate_collected" ? ` ${links} candidate ${links === 1 ? "link was" : "links were"} sent.` : ""}
            </p>
          </div>
        </div>
        <ul className="max-h-[28rem] divide-y overflow-auto rounded-xl ring-1 ring-foreground/[0.07]">
          {results.map((r) => (
            <li key={r.line} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Created" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Not created" />}
              <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">Line {r.line}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.name || "—"}</span>
                {r.ok ? (
                  <>
                    <Link href={`/app/cases/${r.caseId}`} className="ml-2 font-mono text-xs text-primary hover:underline">
                      {r.reference}
                    </Link>
                    {r.candidateReused ? <span className="ml-2 text-xs text-muted-foreground">existing candidate</span> : null}
                    {r.linkSent.length ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="size-3" /> link sent
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="block text-xs text-destructive">{r.error}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setResults(null);
              setFile(null);
            }}
          >
            <RotateCcw /> Import another file
          </Button>
          <Button asChild>
            <Link href={`/app/cases?client=${clientId}`}>Open {client?.name}&rsquo;s cases</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
        <div className="space-y-0.5">
          <h2 className="font-display text-lg font-semibold">1. Who and what</h2>
          <p className="text-sm text-muted-foreground">Everyone in the file becomes a case for the same client, with the same checks.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="import-client">Client</FieldLabel>
              {canAddClient ? (
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline dark:text-brand-sky" onClick={() => setAddingClient(true)}>
                  <Plus className="size-3" /> New client
                </button>
              ) : null}
            </div>
            <QuickClientDialog
              open={addingClient}
              onOpenChange={setAddingClient}
              existing={clients}
              onPick={(client) => {
                setAddingClient(false);
                if (client.name && client.code) setAddedClients((prev) => [{ id: client.id, name: client.name as string, code: client.code as string }, ...prev]);
                setClientId(client.id);
                setSetup("");
              }}
            />
            <Select
              value={clientId}
              onValueChange={(v) => {
                setClientId(v);
                setSetup("");
              }}
            >
              <SelectTrigger id="import-client" className="h-9 w-full">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} <span className="text-muted-foreground">· {c.code}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="import-setup">Template or package</FieldLabel>
            <Select value={setup} onValueChange={choose} disabled={!clientId}>
              <SelectTrigger id="import-setup" className="h-9 w-full">
                <SelectValue placeholder={clientId ? "Choose a template or package" : "Choose the client first"} />
              </SelectTrigger>
              <SelectContent>
                {visibleTemplates.length ? (
                  <SelectGroup>
                    <SelectLabel>Templates</SelectLabel>
                    {visibleTemplates.map((t) => (
                      <SelectItem key={t.id} value={`t:${t.id}`}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                <SelectGroup>
                  <SelectLabel>Packages</SelectLabel>
                  {visiblePackages.map((p) => (
                    <SelectItem key={p.id} value={`p:${p.id}`}>
                      {p.name} <span className="text-muted-foreground">· {p.checks} checks</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {pkg ? (
              <FieldDescription>
                {pkg.name}: {pkg.checks} {pkg.checks === 1 ? "check" : "checks"}, {pkg.tatDays} working days.
              </FieldDescription>
            ) : null}
          </Field>
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
            {processType === "candidate_collected" ? <FieldDescription>Each candidate with an email or mobile number gets their secure link as soon as the case is created.</FieldDescription> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="import-priority">Priority</FieldLabel>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger id="import-priority" className="h-9 w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
            <FileSpreadsheet className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">2. The spreadsheet</h2>
            <p className="text-sm text-muted-foreground">
              A CSV with one candidate per row, up to {IMPORT_MAX_ROWS}. Columns: {IMPORT_COLUMNS.map((c) => c.label).join(", ")}. Only Full name is required.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download /> Template
            </Button>
            <Button variant={file ? "outline" : "default"} onClick={() => input.current?.click()}>
              <Upload /> {file ? "Choose another" : "Choose CSV"}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-label="CSV file"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      {check ? (
        <section className="space-y-4 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold">3. Check the preview</h2>
              <p className="text-sm text-muted-foreground">
                {file?.name}: <span className="font-medium text-foreground">{ready.length}</span> ready · {problems} {problems === 1 ? "needs" : "need"} fixing
              </p>
            </div>
            <div className="flex rounded-lg bg-muted p-[3px] text-sm" role="tablist" aria-label="Rows to show">
              {(["all", "problems"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn("rounded-md px-3 py-1 text-muted-foreground", filter === f && "bg-background font-medium text-foreground shadow-sm")}
                >
                  {f === "all" ? `All ${check.rows.length}` : "Problems"}
                </button>
              ))}
            </div>
          </div>
          {check.missingColumns.length ? (
            <p className="flex items-center gap-2 rounded-xl bg-destructive/8 px-3 py-2.5 text-sm text-destructive ring-1 ring-destructive/20">
              <AlertTriangle className="size-4 shrink-0" /> The file needs a {check.missingColumns.join(", ")} column. Download the template to see the layout.
            </p>
          ) : null}
          {check.tooMany ? (
            <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm ring-1 ring-warning/25">
              <AlertTriangle className="size-4 shrink-0 text-warning-foreground dark:text-warning" /> The file has {check.total} rows; only the first {IMPORT_MAX_ROWS} are shown and imported. Put the rest in
              another file.
            </p>
          ) : null}
          {check.ignoredHeaders.length ? <p className="text-xs text-muted-foreground">Ignored columns: {check.ignoredHeaders.join(", ")}.</p> : null}
          <div className="max-h-[28rem] overflow-auto rounded-xl ring-1 ring-foreground/[0.07]">
            <table className="w-full min-w-[44rem] text-sm">
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
                {shown.map((r) => (
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
                {!shown.length ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {check.rows.length ? "No problems found." : "The file has no rows."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-2xl bg-card/95 p-4 shadow-lift ring-1 ring-foreground/[0.08] backdrop-blur">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {!client ? (
            "Choose a client to start."
          ) : !pkg ? (
            "Choose a template or package."
          ) : !check ? (
            "Choose a CSV file to preview it."
          ) : (
            <>
              <span className="font-semibold text-foreground">{ready.length}</span> {ready.length === 1 ? "case" : "cases"} will be created for {client.name}
              {problems ? `; ${problems} ${problems === 1 ? "row is" : "rows are"} left out` : ""}
            </>
          )}
        </p>
        <Button size="lg" className="h-10 shrink-0 px-5" onClick={() => setConfirming(true)} disabled={pending || !canImport}>
          {pending ? <Spinner /> : <Upload />} Create {ready.length || ""} {ready.length === 1 ? "case" : "cases"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Create {ready.length} {ready.length === 1 ? "case" : "cases"} for {client?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each gets {pkg?.name} and is assigned straight away.
              {processType === "candidate_collected" ? " Candidates with an email or mobile number are sent their link now." : ""} Cases can be cancelled later, not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Create cases</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
