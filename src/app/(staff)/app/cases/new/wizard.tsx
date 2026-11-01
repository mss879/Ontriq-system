"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ClipboardList,
  FileCheck2,
  LayoutTemplate,
  Plus,
  Search,
  Sparkles,
  Star,
  UserRound,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { DISTRICT_CHOICES } from "@/domain/districts";
import { parseNic } from "@/domain/nic-core";
import { PRIORITY_LABELS, PROCESS_TYPE_LABELS, type Priority, type ProcessType } from "@/domain/workflow/stages";
import type { CatalogCheckType, CatalogPackage, CatalogTemplate, ClientOption } from "@/lib/server/cases/queries";
import { ExtraChecksField, type ExtraCheck } from "@/components/cases/extra-checks-field";
import { createCase, findCandidateByNic } from "../actions";
import { QuickClientDialog } from "../../clients/quick-client-dialog";

type Errors = Record<string, string[] | undefined>;

type Form = {
  templateId?: string;
  clientId?: string;
  packageId?: string; // undefined + custom = check list
  custom: boolean;
  checkTypeIds: string[];
  processType: ProcessType;
  priority: Priority;
  positionTitle: string;
  department: string;
  clientReference: string;
  instructions: string;
  internalNotes: string;
  extraChecks: ExtraCheck[];
  candidate: {
    id?: string;
    fullName: string;
    nic: string;
    email: string;
    phone: string;
    address: string;
    district: string;
    preferredLanguage: "en" | "si" | "ta";
  };
};

type Existing = { id: string; fullName: string; email: string | null; phone: string | null; caseCount: number };

const STEPS: { key: string; title: string; icon: LucideIcon }[] = [
  { key: "start", title: "Template", icon: LayoutTemplate },
  { key: "client", title: "Client", icon: Building2 },
  { key: "candidate", title: "Candidate", icon: UserRound },
  { key: "checks", title: "Checks", icon: ClipboardList },
  { key: "review", title: "Review", icon: FileCheck2 },
];

const LANGUAGES = { en: "English", si: "Sinhala", ta: "Tamil" } as const;
const PROCESS_HINT: Record<ProcessType, string> = {
  client_supplied: "Type 1. The client sends the CV and documents; Ontriq reviews and verifies them.",
  candidate_collected: "Type 2. Ontriq contacts the candidate and collects the documents directly.",
};

function applyTemplate(f: Form, t: CatalogTemplate): Form {
  return {
    ...f,
    templateId: t.id,
    clientId: t.clientId ?? f.clientId,
    packageId: t.packageId,
    custom: false,
    processType: t.processType,
    priority: t.priority,
    positionTitle: t.defaults.position_title ?? f.positionTitle,
    department: t.defaults.department ?? f.department,
    internalNotes: t.defaults.instructions ?? f.internalNotes,
  };
}

function stepOf(key: string): number {
  if (key === "clientId") return 1;
  if (key.startsWith("candidate")) return 2;
  return 3;
}

export function NewCaseWizard({
  clients: loadedClients,
  canAddClient,
  checkTypes,
  packages,
  templates,
  initialClientId,
  initialTemplateId,
  initialCandidate,
}: {
  clients: ClientOption[];
  canAddClient: boolean;
  checkTypes: CatalogCheckType[];
  packages: CatalogPackage[];
  templates: CatalogTemplate[];
  initialClientId?: string;
  initialTemplateId?: string;
  initialCandidate?: {
    id: string;
    fullName: string;
    nic: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    district: string | null;
    preferredLanguage: string;
    caseCount: number;
  };
}) {
  const router = useRouter();
  // A client added here stays at the top of the list, where the person just saw it appear.
  const [addedClients, setAddedClients] = useState<ClientOption[]>([]);
  const clients = useMemo(() => [...addedClients, ...loadedClients.filter((c) => !addedClients.some((a) => a.id === c.id))], [addedClients, loadedClients]);
  const typeById = useMemo(() => new Map(checkTypes.map((t) => [t.id, t])), [checkTypes]);
  const packageById = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);

  const [form, setForm] = useState<Form>(() => {
    const base: Form = {
      clientId: initialClientId,
      custom: false,
      checkTypeIds: [],
      processType: "client_supplied",
      priority: "normal",
      positionTitle: "",
      department: "",
      clientReference: "",
      instructions: "",
      internalNotes: "",
      extraChecks: [],
      candidate: initialCandidate
        ? {
            id: initialCandidate.id,
            fullName: initialCandidate.fullName,
            nic: initialCandidate.nic ?? "",
            email: initialCandidate.email ?? "",
            phone: initialCandidate.phone ?? "",
            address: initialCandidate.address ?? "",
            district: initialCandidate.district ?? "",
            preferredLanguage: (initialCandidate.preferredLanguage as Form["candidate"]["preferredLanguage"]) ?? "en",
          }
        : { fullName: "", nic: "", email: "", phone: "", address: "", district: "", preferredLanguage: "en" },
    };
    const t = templates.find((x) => x.id === initialTemplateId);
    return t ? applyTemplate(base, t) : base;
  });
  const [step, setStep] = useState(initialTemplateId ? (initialClientId || templates.find((x) => x.id === initialTemplateId)?.clientId ? 2 : 1) : 0);
  const [errors, setErrors] = useState<Errors>({});
  const [existing, setExisting] = useState<Existing | null>(initialCandidate ?? null);
  const [lookup, setLookup] = useState<{ nic: string; state: "idle" | "looking" | "done" }>({ nic: "", state: "idle" });
  const [creating, startCreate] = useTransition();
  const [, startLookup] = useTransition();

  const client = clients.find((c) => c.id === form.clientId);
  const pkg = form.packageId ? packageById.get(form.packageId) : undefined;
  const chosenTypes = form.custom ? form.checkTypeIds.map((id) => typeById.get(id)).filter((t): t is CatalogCheckType => Boolean(t)) : (pkg?.items ?? []).map((i) => typeById.get(i.checkTypeId)).filter((t): t is CatalogCheckType => Boolean(t));
  const tatDays = form.custom ? (client?.slaDays ?? 7) : (pkg?.tatDays ?? client?.slaDays ?? 7);
  const nicInfo = form.candidate.nic.trim() ? parseNic(form.candidate.nic) : null;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setCandidate = <K extends keyof Form["candidate"]>(key: K, value: Form["candidate"][K]) => setForm((f) => ({ ...f, candidate: { ...f.candidate, [key]: value } }));
  const err = (key: string) => errors[key];

  const pickTemplate = (t: CatalogTemplate | null) => {
    setErrors({});
    if (t) {
      setForm((f) => applyTemplate(f, t));
      setStep(t.clientId || form.clientId ? 2 : 1);
    } else {
      setForm((f) => ({ ...f, templateId: undefined }));
      setStep(form.clientId ? 2 : 1);
    }
  };

  const onNicChange = (value: string) => {
    setCandidate("nic", value);
    const parsed = parseNic(value);
    if (!parsed.valid) {
      if (existing) {
        setExisting(null);
        setForm((f) => ({ ...f, candidate: { ...f.candidate, id: undefined } }));
      }
      setLookup({ nic: "", state: "idle" });
      return;
    }
    if (parsed.canonical === lookup.nic) return;
    setLookup({ nic: parsed.canonical, state: "looking" });
    startLookup(async () => {
      const r = await findCandidateByNic(value);
      setLookup({ nic: parsed.canonical, state: "done" });
      if (r.ok && r.candidate) {
        setExisting(r.candidate);
        setForm((f) => ({
          ...f,
          candidate: {
            ...f.candidate,
            id: r.candidate!.id,
            fullName: r.candidate!.fullName,
            email: f.candidate.email || r.candidate!.email || "",
            phone: f.candidate.phone || r.candidate!.phone || "",
          },
        }));
      } else {
        setExisting(null);
        setForm((f) => ({ ...f, candidate: { ...f.candidate, id: undefined } }));
      }
    });
  };

  // Light checks before moving on; the server validates everything again.
  const validate = (s: number): Errors => {
    const e: Errors = {};
    if (s >= 1 && !form.clientId) e.clientId = ["Choose a client."];
    if (s >= 2) {
      if (!form.candidate.id && form.candidate.fullName.trim().length < 2) e["candidate.fullName"] = ["Enter the candidate's full name."];
      if (nicInfo && !nicInfo.valid) e["candidate.nic"] = [nicInfo.error];
      if (form.candidate.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.candidate.email)) e["candidate.email"] = ["Enter a valid email address."];
    }
    if (s >= 3) {
      if (!form.custom && !form.packageId) e.packageId = ["Choose a package or build a custom selection."];
      if (form.custom && form.checkTypeIds.length === 0) e.packageId = ["Choose at least one check."];
      // Spec 2.2: Type 2 starts by contacting the candidate. Without a way to reach them, nothing would go out.
      if (form.processType === "candidate_collected" && !form.candidate.email.trim() && !form.candidate.phone.trim()) {
        e["candidate.email"] = ["Ontriq collects from this candidate, so add an email or phone number to reach them."];
      }
    }
    return e;
  };

  const next = () => {
    const e = validate(step);
    setErrors(e);
    // Some answers change what an earlier step needs: go to where the problem is.
    if (Object.keys(e).length) {
      setStep((s) => Math.min(s, ...Object.keys(e).map(stepOf)));
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goTo = (target: number) => {
    if (target <= step) {
      setStep(target);
      return;
    }
    const e = validate(target - 1);
    setErrors(e);
    if (Object.keys(e).length) {
      setStep(Math.min(...Object.keys(e).map(stepOf)));
      return;
    }
    setStep(target);
  };

  const submit = () =>
    startCreate(async () => {
      const e = validate(3);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(Math.min(...Object.keys(e).map(stepOf)));
        return;
      }
      const r = await createCase({
        clientId: form.clientId!,
        packageId: form.custom ? undefined : form.packageId,
        checkTypeIds: form.custom ? form.checkTypeIds : undefined,
        templateId: form.templateId,
        processType: form.processType,
        priority: form.priority,
        positionTitle: form.positionTitle,
        department: form.department,
        clientReference: form.clientReference,
        instructions: form.instructions,
        internalNotes: form.internalNotes,
        extraChecks: form.extraChecks.filter((x) => chosenTypes.some((t) => t.id === x.checkTypeId)),
        candidate: {
          id: form.candidate.id,
          fullName: form.candidate.fullName,
          nic: form.candidate.nic,
          email: form.candidate.email,
          phone: form.candidate.phone,
          address: form.candidate.address,
          district: form.candidate.district,
          preferredLanguage: form.candidate.preferredLanguage,
        },
      });
      if (!r.ok) {
        const fe = r.fieldErrors ?? {};
        setErrors(fe);
        toast.error(r.error);
        const keys = Object.keys(fe);
        if (keys.length) setStep(Math.min(...keys.map(stepOf)));
        return;
      }
      const sent = r.candidateLinkSent.map((c) => (c === "sms" ? "SMS" : c)).join(" and ");
      toast.success(`${r.reference} created`, {
        description: [
          r.candidateReused ? "Linked to the existing candidate record." : null,
          sent ? `The candidate's page went out by ${sent}.` : null,
          "Assigning the work now.",
        ]
          .filter(Boolean)
          .join(" "),
      });
      if (form.processType === "candidate_collected" && !sent) toast.warning("The candidate's page didn't go out. Send it from the Candidate section of the case.");
      router.push(`/app/cases/${r.caseId}`);
    });

  const visibleTemplates = templates.filter((t) => !t.clientId || !form.clientId || t.clientId === form.clientId);
  const visiblePackages = packages.filter((p) => p.ownerScope === "org" || p.clientId === form.clientId);

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
      <Stepper step={step} onGo={goTo} />

      <div className="min-w-0 rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
        <div className="p-5 md:p-7">
          {step === 0 ? (
            <StartStep templates={visibleTemplates} packageById={packageById} typeById={typeById} clients={clients} onPick={pickTemplate} selectedId={form.templateId} />
          ) : step === 1 ? (
            <ClientStep
              clients={clients}
              value={form.clientId}
              onChange={(id) => set("clientId", id)}
              canAdd={canAddClient}
              onAdded={(client) => {
                setAddedClients((prev) => [client, ...prev]);
                set("clientId", client.id);
              }}
              error={err("clientId")}
            />
          ) : step === 2 ? (
            <section className="space-y-5">
              <StepTitle title="Who is being verified?" text="Start with the NIC: if Ontriq has checked this person before, the case links to their existing record." />
              <div className="grid gap-4 md:grid-cols-2">
                <Field data-invalid={err("candidate.nic") ? true : undefined}>
                  <FieldLabel htmlFor="nic">NIC number</FieldLabel>
                  <div className="relative">
                    <Input id="nic" value={form.candidate.nic} onChange={(e) => onNicChange(e.target.value)} placeholder="853400937V or 198534000937" autoComplete="off" className="pr-8 font-mono" aria-invalid={err("candidate.nic") ? true : undefined} />
                    {lookup.state === "looking" ? <Spinner className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" /> : null}
                  </div>
                  {nicInfo?.valid ? (
                    <FieldDescription>
                      Born {formatPlainDate(nicInfo.birthDate)} · {nicInfo.gender === "female" ? "Female" : "Male"} · {nicInfo.format === "old" ? "old card" : "new card"}
                    </FieldDescription>
                  ) : nicInfo && !nicInfo.valid && form.candidate.nic.replace(/\s/g, "").length >= 10 ? (
                    <FieldError>{nicInfo.error}</FieldError>
                  ) : (
                    <FieldDescription>Optional, but it prevents duplicate records.</FieldDescription>
                  )}
                  <FieldError errors={err("candidate.nic")?.map((message) => ({ message }))} />
                </Field>
                {existing ? (
                  <div className="flex items-start gap-3 rounded-xl bg-success/8 p-3.5 ring-1 ring-success/20 md:row-span-1">
                    <UserRoundCheck className="mt-0.5 size-5 shrink-0 text-success" />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">Existing candidate: {existing.fullName}</p>
                      <p className="text-muted-foreground">
                        {existing.caseCount} previous {existing.caseCount === 1 ? "case" : "cases"}. This case will use their record.
                      </p>
                    </div>
                  </div>
                ) : (
                  <TextInput id="fullName" label="Full name" value={form.candidate.fullName} onChange={(v) => setCandidate("fullName", v)} errors={err("candidate.fullName")} placeholder="As on the NIC" autoComplete="off" />
                )}
                <TextInput id="email" label="Email" type="email" value={form.candidate.email} onChange={(v) => setCandidate("email", v)} errors={err("candidate.email")} placeholder="name@example.com" />
                <TextInput id="phone" label="Phone" type="tel" value={form.candidate.phone} onChange={(v) => setCandidate("phone", v)} errors={err("candidate.phone")} placeholder="077 123 4567" />
                <Field className="md:col-span-2" data-invalid={err("candidate.address") ? true : undefined}>
                  <FieldLabel htmlFor="address">Address</FieldLabel>
                  <Textarea id="address" rows={2} value={form.candidate.address} onChange={(e) => setCandidate("address", e.target.value)} placeholder="Permanent address" />
                  <FieldError errors={err("candidate.address")?.map((message) => ({ message }))} />
                </Field>
                <Field data-invalid={err("candidate.district") ? true : undefined}>
                  <FieldLabel htmlFor="district">District</FieldLabel>
                  <Select value={form.candidate.district || undefined} onValueChange={(v) => setCandidate("district", v)}>
                    <SelectTrigger id="district" className="w-full">
                      <SelectValue placeholder="Choose a district" />
                    </SelectTrigger>
                    <SelectContent>
                      {DISTRICT_CHOICES.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Address and police checks go to officers who cover it.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="language">Preferred language</FieldLabel>
                  <Select value={form.candidate.preferredLanguage} onValueChange={(v) => setCandidate("preferredLanguage", v as Form["candidate"]["preferredLanguage"])}>
                    <SelectTrigger id="language" className="w-full">
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
                </Field>
              </div>
            </section>
          ) : step === 3 ? (
            <ChecksStep
              form={form}
              set={set}
              packages={visiblePackages}
              checkTypes={checkTypes}
              chosenTypes={chosenTypes}
              tatDays={tatDays}
              error={err("packageId")}
              errors={errors}
            />
          ) : (
            <ReviewStep form={form} client={client} pkg={pkg} chosenTypes={chosenTypes} tatDays={tatDays} existing={existing} onEdit={setStep} />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-4 md:px-7">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={creating}>
              <ArrowLeft /> Back
            </Button>
          ) : (
            <span />
          )}
          {step === 0 ? (
            <Button variant="outline" onClick={() => pickTemplate(null)}>
              Start from scratch <ArrowRight />
            </Button>
          ) : step < STEPS.length - 1 ? (
            <Button onClick={next}>
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button size="lg" className="h-10 px-5" onClick={submit} disabled={creating}>
              {creating ? <Spinner /> : <Check />} Create case
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step, onGo }: { step: number; onGo: (s: number) => void }) {
  return (
    <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-1.5" aria-label="Steps">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const state = i < step ? "done" : i === step ? "current" : "todo";
        return (
          <li key={s.key} className="shrink-0">
            <button
              type="button"
              onClick={() => onGo(i)}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                state === "current" ? "bg-card font-semibold shadow-soft ring-1 ring-foreground/[0.07]" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  state === "done" && "bg-success/12 text-success",
                  state === "current" && "bg-brand-orange/12 text-brand-orange-ink",
                  state === "todo" && "bg-muted",
                )}
              >
                {state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-4" />}
              </span>
              <span className="hidden sm:inline">{s.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepTitle({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-1">
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
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

function priceLabel(p: CatalogPackage) {
  return p.price > 0 ? formatMoney(p.price, p.currency) : "Price not set";
}

function StartStep({
  templates,
  packageById,
  typeById,
  clients,
  onPick,
  selectedId,
}: {
  templates: CatalogTemplate[];
  packageById: Map<string, CatalogPackage>;
  typeById: Map<string, CatalogCheckType>;
  clients: ClientOption[];
  onPick: (t: CatalogTemplate | null) => void;
  selectedId?: string;
}) {
  return (
    <section className="space-y-5">
      <StepTitle title="Start from a template" text="Templates set the package, process type and case details in one click. You can change anything before creating the case." />
      {templates.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No templates yet. Start from scratch, or add templates in Settings → Packages & templates.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => {
            const pkg = packageById.get(t.packageId);
            const owner = t.clientId ? clients.find((c) => c.id === t.clientId)?.name : null;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t)}
                className={cn(
                  "min-w-0 group flex flex-col gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-foreground/[0.08] transition hover:-translate-y-px hover:shadow-lift hover:ring-brand-orange/40",
                  selectedId === t.id && "bg-primary/[0.05] ring-2 ring-primary dark:bg-brand-sky/[0.08] dark:ring-brand-sky",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {t.isFavourite ? <Star className="size-3.5 shrink-0 fill-brand-orange text-brand-orange" aria-label="Favourite" /> : null}
                      <span className="truncate">{t.name}</span>
                    </p>
                    {t.description ? <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{t.description}</p> : null}
                  </div>
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
                {pkg ? (
                  <div className="flex flex-wrap gap-1">
                    {pkg.items.map((i) => (
                      <span key={i.checkTypeId} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {typeById.get(i.checkTypeId)?.name ?? "Check"}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{pkg?.name ?? "Package"}</span>
                  <span>·</span>
                  <span>{pkg?.tatDays ?? "—"} working days</span>
                  <span>·</span>
                  <span>{t.processType === "client_supplied" ? "Client sends documents" : "Ontriq collects"}</span>
                  {pkg ? (
                    <>
                      <span>·</span>
                      <span className={pkg.price > 0 ? "font-medium text-foreground" : undefined}>{priceLabel(pkg)}</span>
                    </>
                  ) : null}
                  {owner ? <span className="rounded-md bg-info/10 px-1.5 py-0.5 text-info">{owner}</span> : null}
                  {t.usageCount > 0 ? <span>· used {t.usageCount}×</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ClientStep({
  clients,
  value,
  onChange,
  canAdd,
  onAdded,
  error,
}: {
  clients: ClientOption[];
  value?: string;
  onChange: (id: string) => void;
  canAdd: boolean;
  onAdded: (client: ClientOption) => void;
  error?: string[];
}) {
  const [q, setQ] = useState("");
  // The name the add dialog opens with, or null while it's closed.
  const [adding, setAdding] = useState<string | null>(null);
  const list = clients.filter((c) => !q.trim() || `${c.name} ${c.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="space-y-5">
      <StepTitle title="Which client is this for?" text="Reports, turnaround and pricing follow the client's settings." />
      <div className="flex items-center justify-between gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="pl-8" aria-label="Search clients" />
        </div>
        {canAdd ? (
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setAdding("")}>
            <Plus /> New client
          </Button>
        ) : null}
      </div>
      {clients.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {canAdd ? "No active clients yet. Add the first one with New client." : "No active clients yet. Someone who manages clients needs to add one first."}
        </p>
      ) : (
        <div role="radiogroup" aria-label="Client" className="-m-1 grid max-h-[26rem] gap-2 overflow-y-auto p-1 sm:grid-cols-2">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={value === c.id}
              onClick={() => onChange(c.id)}
              className={cn(
                "min-w-0 flex items-center gap-3 rounded-xl p-3 text-left ring-1 ring-foreground/[0.08] transition hover:bg-muted/60",
                value === c.id && "bg-primary/[0.05] ring-2 ring-primary dark:bg-brand-sky/[0.08] dark:ring-brand-sky",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">{c.code.slice(0, 3)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.code} · {c.slaDays}-day SLA{c.status === "prospect" ? " · prospect" : ""}
                </span>
              </span>
              {value === c.id ? <Check className="size-4 text-primary dark:text-brand-sky" /> : null}
            </button>
          ))}
          {list.length === 0 ? (
            <div className="col-span-full flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">No clients match “{q.trim()}”.</p>
              {canAdd ? (
                <Button type="button" variant="outline" onClick={() => setAdding(q.trim())}>
                  <Plus /> Add “{q.trim()}” as a new client
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <FieldError errors={error?.map((message) => ({ message }))} />
      <QuickClientDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        initialName={adding ?? ""}
        existing={clients}
        onPick={(client) => {
          setAdding(null);
          setQ("");
          if (client.name) onAdded(client as ClientOption);
          else onChange(client.id);
        }}
      />
    </section>
  );
}

function ChecksStep({
  form,
  set,
  packages,
  checkTypes,
  chosenTypes,
  tatDays,
  error,
  errors,
}: {
  form: Form;
  set: <K extends keyof Form>(key: K, value: Form[K]) => void;
  packages: CatalogPackage[];
  checkTypes: CatalogCheckType[];
  chosenTypes: CatalogCheckType[];
  tatDays: number;
  error?: string[];
  errors: Errors;
}) {
  const toggleType = (id: string) => set("checkTypeIds", form.checkTypeIds.includes(id) ? form.checkTypeIds.filter((x) => x !== id) : [...form.checkTypeIds, id]);
  return (
    <section className="space-y-7">
      <div className="space-y-4">
        <StepTitle title="What should Ontriq check?" text="Choose a package, or build a custom selection of checks for this case." />
        <div role="radiogroup" aria-label="Package" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {packages.map((p) => {
            const selected = !form.custom && form.packageId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  set("custom", false);
                  set("packageId", p.id);
                }}
                className={cn(
                  "min-w-0 flex flex-col gap-2 rounded-2xl p-4 text-left ring-1 ring-foreground/[0.08] transition hover:bg-muted/50",
                  selected && "bg-primary/[0.05] ring-2 ring-primary dark:bg-brand-sky/[0.08] dark:ring-brand-sky",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  {p.ownerScope === "client" ? <span className="rounded-md bg-info/10 px-1.5 py-0.5 text-[11px] text-info">Client package</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.items.length} {p.items.length === 1 ? "check" : "checks"} · {p.tatDays} working days · {priceLabel(p)}
                </span>
                {p.description ? <span className="line-clamp-2 text-[13px] text-muted-foreground">{p.description}</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={form.custom}
            onClick={() => {
              set("custom", true);
              set("packageId", undefined);
            }}
            className={cn(
              "min-w-0 flex flex-col gap-2 rounded-2xl border border-dashed p-4 text-left transition hover:bg-muted/50",
              form.custom && "border-solid border-primary bg-primary/[0.05] ring-1 ring-primary dark:border-brand-sky dark:bg-brand-sky/[0.08]",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-brand-orange" /> Custom selection
            </span>
            <span className="text-[13px] text-muted-foreground">Pick exactly the checks this case needs.</span>
          </button>
        </div>
        {form.custom ? (
          <div className="flex flex-wrap gap-2 rounded-xl bg-muted/40 p-3">
            {checkTypes.map((t) => {
              const on = form.checkTypeIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleType(t.id)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm ring-1 transition",
                    on ? "bg-primary text-primary-foreground ring-primary dark:bg-brand-sky dark:text-brand dark:ring-brand-sky" : "bg-card ring-border hover:bg-muted",
                  )}
                >
                  {on ? <Check className="size-3.5" /> : null}
                  {t.name}
                </button>
              );
            })}
          </div>
        ) : null}
        <FieldError errors={error?.map((message) => ({ message }))} />
        {chosenTypes.length ? (
          <p className="text-xs text-muted-foreground">
            {chosenTypes.length} {chosenTypes.length === 1 ? "check" : "checks"}: {chosenTypes.map((t) => t.name).join(", ")}. Due in {tatDays} working days.
          </p>
        ) : null}
        <ExtraChecksField types={chosenTypes} value={form.extraChecks} onChange={(next) => set("extraChecks", next)} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">How are documents collected?</h3>
        <div role="radiogroup" aria-label="Process type" className="grid gap-3 md:grid-cols-2">
          {(["client_supplied", "candidate_collected"] as ProcessType[]).map((pt) => (
            <button
              key={pt}
              type="button"
              role="radio"
              aria-checked={form.processType === pt}
              onClick={() => set("processType", pt)}
              className={cn(
                "min-w-0 rounded-2xl p-4 text-left ring-1 ring-foreground/[0.08] transition hover:bg-muted/50",
                form.processType === pt && "bg-primary/[0.05] ring-2 ring-primary dark:bg-brand-sky/[0.08] dark:ring-brand-sky",
              )}
            >
              <span className="block text-sm font-semibold">{PROCESS_TYPE_LABELS[pt]}</span>
              <span className="mt-1 block text-[13px] text-muted-foreground">{PROCESS_HINT[pt]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel>Priority</FieldLabel>
          <div role="radiogroup" aria-label="Priority" className="flex gap-1 rounded-lg bg-muted p-0.5">
            {(["normal", "high", "urgent"] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={form.priority === p}
                onClick={() => set("priority", p)}
                className={cn(
                  "h-8 flex-1 rounded-md text-sm font-medium transition",
                  form.priority === p ? "bg-card shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground",
                  form.priority === p && p === "urgent" && "text-destructive",
                )}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </Field>
        <TextInput id="clientReference" label="Client's reference" value={form.clientReference} onChange={(v) => set("clientReference", v)} errors={errors.clientReference} placeholder="e.g. HR-2026-118" />
        <TextInput id="positionTitle" label="Position" value={form.positionTitle} onChange={(v) => set("positionTitle", v)} errors={errors.positionTitle} placeholder="e.g. Senior Engineer" />
        <TextInput id="department" label="Department" value={form.department} onChange={(v) => set("department", v)} errors={errors.department} placeholder="e.g. Finance" />
        <Field className="md:col-span-2" data-invalid={errors.internalNotes ? true : undefined}>
          <FieldLabel htmlFor="internalNotes">Instructions for the team</FieldLabel>
          <Textarea id="internalNotes" rows={3} value={form.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} placeholder="Anything the officers should know. Clients never see this." />
          <FieldError errors={errors.internalNotes?.map((message) => ({ message }))} />
        </Field>
        <Field className="md:col-span-2" data-invalid={errors.instructions ? true : undefined}>
          <FieldLabel htmlFor="instructions">Instructions from the client</FieldLabel>
          <Textarea id="instructions" rows={2} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="What the client asked for. They see this on their portal." />
          <FieldDescription>Optional. The client reads this as their own request.</FieldDescription>
          <FieldError errors={errors.instructions?.map((message) => ({ message }))} />
        </Field>
      </div>
    </section>
  );
}

function ReviewStep({
  form,
  client,
  pkg,
  chosenTypes,
  tatDays,
  existing,
  onEdit,
}: {
  form: Form;
  client?: ClientOption;
  pkg?: CatalogPackage;
  chosenTypes: CatalogCheckType[];
  tatDays: number;
  existing: Existing | null;
  onEdit: (step: number) => void;
}) {
  const nic = form.candidate.nic.trim() ? parseNic(form.candidate.nic) : null;
  const rows: { label: string; value: React.ReactNode; step: number }[] = [
    { label: "Client", value: client ? `${client.name} (${client.code})` : "—", step: 1 },
    {
      label: "Candidate",
      value: (
        <>
          {existing ? existing.fullName : form.candidate.fullName || "—"}
          {existing ? <span className="ml-2 rounded-md bg-success/10 px-1.5 py-0.5 text-[11px] text-success">Existing record</span> : null}
        </>
      ),
      step: 2,
    },
    { label: "NIC", value: nic?.valid ? `${nic.display} · born ${formatPlainDate(nic.birthDate)}` : "Not given", step: 2 },
    { label: "Contact", value: [form.candidate.email, form.candidate.phone].filter(Boolean).join(" · ") || "Not given", step: 2 },
    { label: "Package", value: form.custom ? "Custom selection" : (pkg?.name ?? "—"), step: 3 },
    { label: "Checks", value: chosenTypes.map((t) => t.name).join(", ") || "—", step: 3 },
    { label: "Documents", value: PROCESS_TYPE_LABELS[form.processType], step: 3 },
    { label: "Turnaround", value: `${tatDays} working days · ${PRIORITY_LABELS[form.priority]} priority`, step: 3 },
    { label: "Position", value: [form.positionTitle, form.department].filter(Boolean).join(" · ") || "Not given", step: 3 },
  ];
  if (form.clientReference) rows.push({ label: "Client's reference", value: form.clientReference, step: 3 });
  if (form.extraChecks.length) rows.push({ label: "Other records", value: form.extraChecks.map((x) => x.label).join(", "), step: 3 });
  if (form.internalNotes) rows.push({ label: "For the team", value: form.internalNotes, step: 3 });
  if (form.instructions) rows.push({ label: "From the client", value: form.instructions, step: 3 });

  return (
    <section className="space-y-5">
      <StepTitle title="Check and create" text="Ontriq creates the checks and the document list, then assigns the case to the freest qualified officer." />
      <dl className="divide-y rounded-xl ring-1 ring-foreground/[0.08]">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
            <dt className="w-36 shrink-0 text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:pt-0.5">{r.label}</dt>
            <dd className="min-w-0 flex-1 text-sm break-words whitespace-pre-line">{r.value}</dd>
            <button type="button" onClick={() => onEdit(r.step)} className="self-start text-xs font-medium text-primary hover:underline dark:text-brand-sky">
              Change
            </button>
          </div>
        ))}
      </dl>
    </section>
  );
}
