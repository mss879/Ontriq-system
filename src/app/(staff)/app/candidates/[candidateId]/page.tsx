import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FilePlus2, IdCard } from "lucide-react";
import { Eyebrow, Page, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader, TH } from "@/components/admin/surface";
import { ChecksProgress, ResultBadge, shownResult, StagePill } from "@/components/cases/badges";
import { statusLabeller } from "@/lib/server/cases/status-catalog";
import { PersonAvatar } from "@/components/cases/person";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaffViewer } from "@/lib/server/viewer";
import { getCandidate, getCandidateCases } from "@/lib/server/admin/candidates";
import { formatDate, formatPlainDate } from "@/lib/format";
import { can, canAny } from "@/domain/permissions";
import { parseNic } from "@/domain/nic-core";

export const metadata: Metadata = { title: "Candidate" };

const LANGUAGES: Record<string, string> = { en: "English", si: "Sinhala", ta: "Tamil" };

export default function CandidatePage({ params }: PageProps<"/app/candidates/[candidateId]">) {
  return (
    <Page>
      <Link href="/app/candidates" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Candidates
      </Link>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Candidate params={params} />
      </Suspense>
    </Page>
  );
}

async function Candidate({ params }: Pick<PageProps<"/app/candidates/[candidateId]">, "params">) {
  const [viewer, { candidateId }] = await Promise.all([getStaffViewer(), params]);
  if (!canAny(viewer, ["cases.read", "candidates.manage", "cases.read_assigned"])) redirect("/app");
  const candidate = /^[0-9a-f-]{36}$/.test(candidateId) ? await getCandidate(candidateId) : null;
  if (!candidate) notFound();
  const [cases, labelFor] = await Promise.all([getCandidateCases(candidate.id), statusLabeller()]);
  const nic = candidate.nic ? parseNic(candidate.nic) : null;

  const details: [string, React.ReactNode][] = [
    ["Date of birth", candidate.dateOfBirth ? formatPlainDate(candidate.dateOfBirth) : null],
    ["Gender", candidate.gender ? candidate.gender.charAt(0).toUpperCase() + candidate.gender.slice(1) : null],
    ["Email", candidate.email ? <a className="hover:underline" href={`mailto:${candidate.email}`}>{candidate.email}</a> : null],
    ["Phone", candidate.phone ? <a className="hover:underline" href={`tel:${candidate.phone}`}>{candidate.phone}</a> : null],
    ["Address", candidate.address],
    ["District", candidate.district],
    ["Language", LANGUAGES[candidate.preferredLanguage] ?? candidate.preferredLanguage],
    ["Added for", candidate.addedFor?.name],
    ["First seen", formatDate(candidate.createdAt)],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <PersonAvatar id={candidate.id} name={candidate.fullName} size="lg" className="size-14 rounded-2xl text-base" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Eyebrow>Candidate</Eyebrow>
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">{candidate.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {cases.length} {cases.length === 1 ? "case" : "cases"}
            {candidate.nic ? ` · NIC ${candidate.nic}` : ""}
          </p>
        </div>
        {can(viewer, "cases.create") && !candidate.erased ? (
          <Button asChild className="shrink-0 self-start sm:self-center">
            <Link href={`/app/cases/new?candidate=${candidate.id}${candidate.addedFor ? `&client=${candidate.addedFor.id}` : ""}`}>
              <FilePlus2 /> Start a case
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Surface className="min-w-0">
          <SurfaceHeader title="Cases" description="Every verification Ontriq has run for this person, newest first." />
          {cases.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">{candidate.addedFor ? "No case yet." : "No cases you can see."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className={`${TH} pl-5`}>Case</TableHead>
                  <TableHead className={TH}>Stage</TableHead>
                  <TableHead className={`${TH} hidden sm:table-cell`}>Checks</TableHead>
                  <TableHead className={`${TH} pr-5`}>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-5">
                      <Link href={`/app/cases/${c.id}`} className="font-medium hover:underline">
                        {c.reference}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.clientName}
                        {c.positionTitle ? ` · ${c.positionTitle}` : ""} · {formatDate(c.receivedAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StagePill stage={c.stage} onHold={c.onHold} />
                        <span className="text-[11px] text-muted-foreground">{labelFor(c.statusKey)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <ChecksProgress done={c.checksDone} total={c.checksTotal} />
                    </TableCell>
                    <TableCell className="pr-5">
                      <ResultBadge result={shownResult(c)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Surface>

        <div className="min-w-0 space-y-6">
          <Surface>
            <SurfaceHeader title="Details" />
            <dl className="divide-y text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-5 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">{value ?? <span className="text-muted-foreground">—</span>}</dd>
                </div>
              ))}
            </dl>
          </Surface>
          {nic ? (
            <Surface>
              <SurfaceHeader title="NIC number" />
              <div className="flex items-start gap-3 px-5 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
                  <IdCard className="size-4" />
                </span>
                {nic.valid ? (
                  <div className="space-y-1 text-sm">
                    <p className="font-mono">{nic.display}</p>
                    <p className="text-muted-foreground">
                      {nic.format === "old" ? "Old format" : "New format"} · born {formatPlainDate(nic.birthDate)} · {nic.gender}
                    </p>
                    {nic.format === "old" ? <p className="text-xs text-muted-foreground">New-format equivalent: {nic.canonical}</p> : null}
                  </div>
                ) : (
                  <p className="text-sm text-destructive">{nic.error}</p>
                )}
              </div>
            </Surface>
          ) : null}
        </div>
      </div>
    </div>
  );
}
