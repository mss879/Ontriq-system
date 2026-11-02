"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "@/components/link";
import { ArrowRight, CheckCircle2, CloudUpload, FilePlus2, Mail, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatPlainDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DISTRICT_CHOICES } from "@/domain/districts";
import { parseNic } from "@/domain/nic-core";
import { uploadOne, UPLOAD_ACCEPT_ATTR } from "@/lib/client/upload";
import type { PortalPackage, PortalTemplate } from "@/lib/server/portal/queries";
import { createPortalRequest, portalBeginUpload, portalFinalizeUpload, type PortalRequestInput } from "../actions";
import { PackagePicker, PROCESS_LABEL, priceText, CheckChips, type PackageChoice } from "./package-picker";
import { ExtraChecksField, type ExtraCheck } from "@/components/cases/extra-checks-field";
import { toWire } from "@/lib/wire";

const LANGUAGES = { en: "English", si: "Sinhala", ta: "Tamil" } as const;
const PROCESS_HINT = {
  client_supplied: "You send the CV and documents through this portal; Ontriq reviews and verifies them.",
  candidate_collected: "Ontriq emails the candidate a secure link and collects their documents directly.",
} as const;

type Form = {
  processType: "client_supplied" | "candidate_collected";
  priority: "normal" | "high" | "urgent";
  positionTitle: string;
  department: string;
  clientReference: string;
  instructions: string;
  extraChecks: ExtraCheck[];
  fullName: string;
  nic: string;
  email: string;
  phone: string;
  address: string;
  district: string;
  preferredLanguage: "en" | "si" | "ta";
};

const EMPTY: Form = {
  processType: "client_supplied",
  priority: "normal",
  positionTitle: "",
  department: "",
  clientReference: "",
  instructions: "",
  extraChecks: [],
  fullName: "",
  nic: "",
  email: "",
  phone: "",
  address: "",
  district: "",
  preferredLanguage: "en",
};

export function RequestForm({ templates, packages, initialTemplateId }: { templates: PortalTemplate[]; packages: PortalPackage[]; initialTemplateId?: string }) {
  const first = templates.find((t) => t.id === initialTemplateId) ?? templates[0];
  const [pick, setPick] = useState<PackageChoice>(() => (first ? { templateId: first.id, packageId: first.package_id } : { packageId: packages[0]?.id }));
  const [form, setForm] = useState<Form>(() => (first ? applyTemplate(EMPTY, first) : { ...EMPTY, processType: packages[0]?.default_process_type ?? "client_supplied" }));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const [created, setCreated] = useState<{ caseId: string; reference: string; name: string } | null>(null);

  const pkg = packages.find((p) => p.id === pick.packageId);
  const nic = useMemo(() => (form.nic.trim() ? parseNic(form.nic) : null), [form.nic]);
  const err = (k: string) => errors[k];
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function onPick(p: PackageChoice) {
    setPick(p);
    const t = p.templateId ? templates.find((x) => x.id === p.templateId) : null;
    if (t) setForm((f) => applyTemplate(f, t));
    else {
      const next = packages.find((x) => x.id === p.packageId);
      if (next) setForm((f) => ({ ...f, processType: next.default_process_type }));
    }
  }

  function submit() {
    if (!pick.packageId) {
      toast.error("Choose a package or template first.");
      return;
    }
    const input: PortalRequestInput = {
      packageId: pick.packageId,
      templateId: pick.templateId ?? "",
      processType: form.processType,
      priority: form.priority,
      positionTitle: form.positionTitle,
      department: form.department,
      clientReference: form.clientReference,
      instructions: form.instructions,
      extraChecks: form.extraChecks.filter((x) => pkg?.items.some((i) => i.check_type_id === x.checkTypeId)),
      candidate: {
        fullName: form.fullName,
        nic: form.nic,
        email: form.email,
        phone: form.phone,
        address: form.address,
        district: form.district,
        preferredLanguage: form.preferredLanguage,
      },
    };
    start(async () => {
      const r = await createPortalRequest(input);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      setErrors({});
      setCreated({ caseId: r.caseId, reference: r.reference, name: form.fullName });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (created) {
    return (
      <Created
        created={created}
        clientSupplied={form.processType === "client_supplied"}
        onAnother={() => {
          setCreated(null);
          setForm((f) => ({ ...EMPTY, processType: f.processType, priority: f.priority, positionTitle: f.positionTitle, department: f.department, instructions: f.instructions }));
        }}
      />
    );
  }

  if (!packages.length) {
    return (
      <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No packages are available to your company yet. Ask your Ontriq contact to set one up for you.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Panel step={1} title="What should Ontriq check?" text="Templates fill in everything for a role you hire often. Packages list the checks and the price.">
        <PackagePicker templates={templates} packages={packages} value={pick} onPick={onPick} />
        <FieldError errors={err("packageId")?.map((message) => ({ message }))} className="mt-3" />
      </Panel>

      <Panel step={2} title="Who is being verified?" text="The NIC lets Ontriq link this request to anyone they have checked before.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput id="fullName" label="Full name" value={form.fullName} onChange={(v) => set("fullName", v)} errors={err("candidate.fullName")} placeholder="As on the NIC" autoComplete="off" />
          <Field data-invalid={err("candidate.nic") ? true : undefined}>
            <FieldLabel htmlFor="nic">NIC number</FieldLabel>
            <Input id="nic" value={form.nic} onChange={(e) => set("nic", e.target.value)} placeholder="853400937V or 198534000937" autoComplete="off" className="font-mono" aria-invalid={err("candidate.nic") ? true : undefined} />
            {nic?.valid ? (
              <FieldDescription className="flex items-center gap-1.5">
                <UserRoundCheck className="size-3.5 text-success" /> Born {formatPlainDate(nic.birthDate)} · {nic.gender === "female" ? "Female" : "Male"}
              </FieldDescription>
            ) : nic && !nic.valid && form.nic.replace(/\s/g, "").length >= 10 ? (
              <FieldError>{nic.error}</FieldError>
            ) : (
              <FieldDescription>Optional, but it avoids duplicate records.</FieldDescription>
            )}
            <FieldError errors={err("candidate.nic")?.map((message) => ({ message }))} />
          </Field>
          <TextInput id="email" label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} errors={err("candidate.email")} placeholder="name@example.com" />
          <TextInput id="phone" label="Mobile" type="tel" value={form.phone} onChange={(v) => set("phone", v)} errors={err("candidate.phone")} placeholder="077 123 4567" />
          <Field className="md:col-span-2" data-invalid={err("candidate.address") ? true : undefined}>
            <FieldLabel htmlFor="address">Address</FieldLabel>
            <Textarea id="address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Permanent address (optional)" />
            <FieldError errors={err("candidate.address")?.map((message) => ({ message }))} />
          </Field>
          <Field data-invalid={err("candidate.district") ? true : undefined}>
            <FieldLabel htmlFor="district">District</FieldLabel>
            <Select value={form.district || undefined} onValueChange={(v) => set("district", v)}>
              <SelectTrigger id="district" className="w-full">
                <SelectValue placeholder="Choose a district">{form.district || undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DISTRICT_CHOICES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={err("candidate.district")?.map((message) => ({ message }))} />
          </Field>
          <Field>
            <FieldLabel htmlFor="language">Preferred language</FieldLabel>
            <Select value={form.preferredLanguage} onValueChange={(v) => set("preferredLanguage", v as Form["preferredLanguage"])}>
              <SelectTrigger id="language" className="w-full">
                <SelectValue>{LANGUAGES[form.preferredLanguage]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LANGUAGES).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Used when Ontriq contacts the candidate.</FieldDescription>
          </Field>
        </div>
      </Panel>

      <Panel step={3} title="About the role" text="Helps Ontriq and your team find this request later.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput id="position" label="Position" value={form.positionTitle} onChange={(v) => set("positionTitle", v)} errors={err("positionTitle")} placeholder="e.g. Finance Manager" />
          <TextInput id="department" label="Department" value={form.department} onChange={(v) => set("department", v)} errors={err("department")} placeholder="e.g. Finance" />
          <TextInput id="clientReference" label="Your reference" value={form.clientReference} onChange={(v) => set("clientReference", v)} errors={err("clientReference")} placeholder="Employee or requisition number" />
          <Field>
            <FieldLabel htmlFor="priority">Priority</FieldLabel>
            <Select value={form.priority} onValueChange={(v) => set("priority", v as Form["priority"])}>
              <SelectTrigger id="priority" className="w-full">
                <SelectValue>{{ normal: "Normal", high: "High", urgent: "Urgent" }[form.priority]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel>Who provides the documents?</FieldLabel>
            <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Who provides the documents">
              {(["client_supplied", "candidate_collected"] as const).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  role="radio"
                  aria-checked={form.processType === pt}
                  onClick={() => set("processType", pt)}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl p-3.5 text-left ring-1 ring-foreground/[0.1] transition hover:ring-brand-orange/40",
                    form.processType === pt && "bg-brand-orange/[0.04] ring-2 ring-brand-orange",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {pt === "client_supplied" ? <CloudUpload className="size-4 text-primary" /> : <Mail className="size-4 text-primary" />}
                    {PROCESS_LABEL[pt]}
                  </span>
                  <span className="text-[13px] leading-relaxed text-muted-foreground">{PROCESS_HINT[pt]}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field className="md:col-span-2" data-invalid={err("instructions") ? true : undefined}>
            <FieldLabel htmlFor="instructions">Instructions for Ontriq</FieldLabel>
            <Textarea id="instructions" rows={3} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Anything Ontriq should know (optional)" />
            <FieldError errors={err("instructions")?.map((message) => ({ message }))} />
          </Field>
          {pkg ? (
            <div className="md:col-span-2">
              <ExtraChecksField types={pkg.items.map((i) => ({ id: i.check_type_id, name: i.name }))} value={form.extraChecks} onChange={(next) => set("extraChecks", next)} />
            </div>
          ) : null}
        </div>
      </Panel>

      <div className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-2xl bg-card/95 p-4 shadow-lift ring-1 ring-foreground/[0.08] backdrop-blur sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-semibold">
            {pkg ? pkg.name : "No package chosen"}
            {pkg ? <span className="font-normal text-muted-foreground"> · {pkg.tat_days} working days · {priceText(pkg)}</span> : null}
          </p>
          {pkg ? <CheckChips names={pkg.items.map((i) => i.name)} /> : null}
        </div>
        <Button size="lg" className="h-10 shrink-0 px-5" onClick={submit} disabled={pending || !pkg}>
          {pending ? <Spinner /> : <ArrowRight />} Send request
        </Button>
      </div>
    </div>
  );
}

function applyTemplate(f: Form, t: PortalTemplate): Form {
  return {
    ...f,
    processType: t.process_type,
    priority: t.priority,
    positionTitle: t.defaults.position_title ?? f.positionTitle,
    department: t.defaults.department ?? f.department,
    instructions: t.defaults.instructions ?? f.instructions,
  };
}

function Panel({ step, title, text, children }: { step: number; title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{step}</span>
        <div className="space-y-0.5">
          <h2 className="font-display text-lg leading-tight font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function TextInput({
  id,
  label,
  value,
  onChange,
  errors,
  className,
  ...rest
}: { id: string; label: string; value: string; onChange: (v: string) => void; errors?: string[]; className?: string } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "id">) {
  return (
    <Field className={className} data-invalid={errors?.length ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={errors?.length ? true : undefined} {...rest} />
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}

/** After sending: the reference, an optional CV upload, and where to go next. */
function Created({ created, clientSupplied, onAnother }: { created: { caseId: string; reference: string; name: string }; clientSupplied: boolean; onAnother: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files).slice(0, 5)) {
      const r = await uploadOne(
        file,
        (meta) => portalBeginUpload(toWire({ caseId: created.caseId, category: "cv" as const, ...meta })),
        (id, sha) => portalFinalizeUpload(id, sha),
      );
      if (r.ok) setUploaded((u) => [...u, file.name]);
      else toast.error(file.name, { description: r.error });
    }
    setUploading(false);
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      <div className="flex flex-col items-center gap-3 border-b bg-success/[0.05] px-6 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-success/12 text-success">
          <CheckCircle2 className="size-6" />
        </span>
        <h2 className="font-display text-2xl font-semibold tracking-tight">Request sent</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          <span className="font-mono text-foreground">{created.reference}</span> for {created.name} is with Ontriq.{" "}
          {clientSupplied ? "They will confirm it and tell you which documents to send." : "Ontriq will contact the candidate for their documents."}
        </p>
      </div>
      <div className="flex flex-col gap-4 p-5 md:p-6">
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Attach the candidate&apos;s CV</p>
            <p className="text-[13px] text-muted-foreground">
              {uploaded.length ? `Uploaded: ${uploaded.join(", ")}` : "Ontriq needs it to start. A PDF or clear photos, up to 25 MB each."}
            </p>
          </div>
          <label className={cn("inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted", uploading && "pointer-events-none opacity-60")}>
            {uploading ? <Spinner /> : <FilePlus2 className="size-4" />}
            {uploading ? "Uploading…" : uploaded.length ? "Add more" : "Upload CV"}
            <input type="file" multiple accept={UPLOAD_ACCEPT_ATTR} className="sr-only" onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = "";
            }} />
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onAnother}>
            Send another
          </Button>
          <Button asChild>
            <Link href={`/portal/cases/${created.caseId}`}>
              View request <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
