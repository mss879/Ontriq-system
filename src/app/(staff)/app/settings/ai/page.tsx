import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleCheck, CircleAlert, Sparkles } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader, TH } from "@/components/admin/surface";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaffViewer } from "@/lib/server/viewer";
import { aiSettings } from "@/lib/server/billing/queries";
import { formatDateTime } from "@/lib/format";
import { can, canAny } from "@/domain/permissions";
import { MODELS } from "@/domain/ai/cost-model";
import { CapabilitiesTable } from "./capabilities-table";
import { BudgetsForm } from "./budgets-form";
import { UsageChart } from "./usage-chart";

export const metadata: Metadata = { title: "AI" };

const usd = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const modelName = (id: string) => Object.values(MODELS).find((m) => m.id === id)?.name ?? id;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export default function AiSettingsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Administration"
        title="AI"
        description="What AI does in Ontriq, which model does it, and what it costs. AI only suggests: people confirm every result that matters."
      />
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <Content />
      </Suspense>
    </Page>
  );
}

async function Content() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, ["ai.configure", "ai.usage.read"])) redirect("/app");
  const ai = await aiSettings();
  const editable = can(viewer, "ai.configure");
  const labels = Object.fromEntries(ai.capabilities.map((c) => [c.key, c.label]));
  const monthTotal = ai.monthByModel.reduce((a, r) => a + r.cost_usd, 0);
  const monthRuns = ai.monthByModel.reduce((a, r) => a + r.runs, 0);
  const thirtyTotal = ai.usageByDay.reduce((a, r) => a + r.cost_usd, 0);
  const todayTotal = ai.usageByDay.find((d) => d.key === ai.today)?.cost_usd ?? 0;
  const monthByCap = Object.fromEntries(ai.monthByCapability.map((r) => [r.key, r.cost_usd]));
  // Today's spend per capability is not split out; the org-wide row carries today's total.
  const spent: Record<string, { today: number; month: number }> = { "": { today: todayTotal, month: monthTotal } };
  for (const b of ai.budgets) if (b.capability) spent[b.capability] = { today: 0, month: monthByCap[b.capability] ?? 0 };
  const enabled = ai.capabilities.filter((c) => c.enabled).length;

  return (
    <>
      {ai.configured ? (
        <Alert>
          <CircleCheck />
          <AlertTitle>AI is connected</AlertTitle>
          <AlertDescription>
            {enabled} of {ai.capabilities.length} capabilities are on. Changes here reach the workers within a minute.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>AI is not set up</AlertTitle>
          <AlertDescription>
            Add the ANTHROPIC_API_KEY environment variable on the server. Until then, everything works by hand: uploads aren&apos;t read, slips aren&apos;t pre-filled and
            reports have no drafted narrative.
          </AlertDescription>
        </Alert>
      )}

      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Spent this month", value: usd(monthTotal), note: `${monthRuns.toLocaleString()} calls` },
          { label: "Spent today", value: usd(todayTotal), note: "Colombo time" },
          { label: "Last 30 days", value: usd(thirtyTotal), note: `${ai.usageByDay.reduce((a, r) => a + r.runs, 0).toLocaleString()} calls` },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/[0.06]">
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{t.value}</dd>
            <dd className="text-xs text-muted-foreground">{t.note}</dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Surface>
          <SurfaceHeader title="Daily spend" description="Last 30 days, in US dollars at list prices." />
          <UsageChart days={ai.usageByDay} today={ai.today} />
          {ai.usageByCapability.length ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className={`${TH} pl-5`}>Capability</TableHead>
                  <TableHead className={`${TH} text-right`}>Calls</TableHead>
                  <TableHead className={`${TH} hidden text-right sm:table-cell`}>Tokens in / out</TableHead>
                  <TableHead className={`${TH} pr-5 text-right`}>Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ai.usageByCapability.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="max-w-56 truncate pl-5 text-sm">{labels[r.key] ?? r.key}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{r.runs.toLocaleString()}</TableCell>
                    <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums sm:table-cell">
                      {tokens(r.input_tokens)} / {tokens(r.output_tokens)}
                    </TableCell>
                    <TableCell className="pr-5 text-right text-sm font-medium tabular-nums">{usd(r.cost_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </Surface>
        <div className="space-y-6">
          <Surface>
            <SurfaceHeader title="Budgets" description="Pause stops non-essential AI calls once a limit is reached. Alert only warns." />
            <BudgetsForm budgets={ai.budgets} labels={labels} spent={spent} editable={editable} />
          </Surface>
          <Surface>
            <SurfaceHeader title="This month by model" />
            {ai.rates.length ? (
              <ul className="divide-y text-sm">
                {ai.rates.map((r) => {
                  const m = ai.monthByModel.find((x) => x.key === r.model);
                  return (
                    <li key={r.model} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate">{modelName(r.model)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.unit === "minute" ? `$${r.input_rate} a minute of audio` : `$${r.input_rate} in · $${r.output_rate} out per million tokens`}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{usd(m?.cost_usd ?? 0)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Surface>
        </div>
      </div>

      <Surface>
        <SurfaceHeader title="Capabilities" description={editable ? "Turn each one on or off, and choose its model, effort and output limit." : "Ask someone who can configure AI to change these."} />
        <CapabilitiesTable capabilities={ai.capabilities} spend={monthByCap} editable={editable} />
      </Surface>

      <Surface>
        <SurfaceHeader title="Recent calls" />
        {ai.runs.length ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className={`${TH} pl-5`}>When</TableHead>
                <TableHead className={TH}>Capability</TableHead>
                <TableHead className={`${TH} hidden md:table-cell`}>Model</TableHead>
                <TableHead className={`${TH} hidden text-right sm:table-cell`}>Tokens</TableHead>
                <TableHead className={`${TH} hidden text-right md:table-cell`}>Time</TableHead>
                <TableHead className={`${TH} pr-5 text-right`}>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ai.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-5 text-sm whitespace-nowrap">{formatDateTime(r.created_at)}</TableCell>
                  <TableCell className="max-w-56 text-sm">
                    <span className="block truncate">{labels[r.capability] ?? r.capability}</span>
                    {r.status !== "ok" ? (
                      <span className="block truncate text-xs text-destructive" title={r.error ?? undefined}>
                        {r.status === "error" ? (r.error ?? "Failed") : r.status === "refused" ? "Declined by the model" : "Cut short at the output limit"}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{modelName(r.model)}</TableCell>
                  <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums sm:table-cell">
                    {tokens(r.input_tokens)} / {tokens(r.output_tokens)}
                  </TableCell>
                  <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums md:table-cell">{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</TableCell>
                  <TableCell className="pr-5 text-right text-sm font-medium tabular-nums">{usd(r.cost_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sparkles />
              </EmptyMedia>
              <EmptyTitle>No AI calls yet</EmptyTitle>
              <EmptyDescription>Every call is listed here with its tokens and cost.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </Surface>
    </>
  );
}
