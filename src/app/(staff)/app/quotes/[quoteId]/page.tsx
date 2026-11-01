import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Building2, CircleAlert } from "lucide-react";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { QuoteBuilder } from "@/components/quotes/quote-builder";
import { QuoteStatusChip, QuoteTimeline } from "@/components/quotes/quote-status";
import { RefreshWhile } from "@/components/quotes/refresh-while";
import { getStaffViewer } from "@/lib/server/viewer";
import { canReadQuotes, getQuoteBuilder } from "@/lib/server/quotes/queries";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Quotation" };

export default function QuotePage({ params }: PageProps<"/app/quotes/[quoteId]">) {
  return (
    <Page className="max-w-[90rem]">
      <Link href="/app/quotes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Quotes
      </Link>
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: Pick<PageProps<"/app/quotes/[quoteId]">, "params">) {
  const [viewer, { quoteId }] = await Promise.all([getStaffViewer(), params]);
  if (!canReadQuotes(viewer)) redirect("/app");
  const data = /^[0-9a-f-]{36}$/.test(quoteId) ? await getQuoteBuilder(quoteId, viewer) : null;
  if (!data) notFound();
  const q = data.quote;
  const preparing = q.rawStatus !== "draft" && (!data.document || data.document.status === "queued");

  return (
    <div className="space-y-6">
      <RefreshWhile active={preparing} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">
              {q.number ? `Quotation ${q.number}` : "Draft quotation"}
              {q.version > 1 ? <span className="ml-2 text-lg text-muted-foreground">v{q.version}</span> : null}
            </h1>
            <QuoteStatusChip status={q.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Link href={`/app/clients/${data.client.id}`} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
              <Building2 className="size-4" /> {data.client.name}
            </Link>
            <span>Valid until {formatPlainDate(data.draft.valid_until)}</span>
            {q.sent_at ? <span>Sent {formatDateTime(q.sent_at)}</span> : null}
            {q.viewed_at ? <span>Opened {formatDateTime(q.viewed_at)}</span> : null}
          </p>
        </div>
        {data.versions.length > 1 ? (
          <nav aria-label="Versions" className="flex flex-wrap gap-1">
            {data.versions.map((v) => (
              <Link
                key={v.id}
                href={`/app/quotes/${v.id}`}
                aria-current={v.id === q.id ? "page" : undefined}
                className={cn("rounded-lg px-2.5 py-1 text-xs font-medium ring-1", v.id === q.id ? "bg-primary/8 text-foreground ring-primary/40" : "text-muted-foreground ring-border hover:bg-muted/50")}
              >
                v{v.version} · {v.status}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {q.accepted_at ? (
        <Banner tone="success">
          Accepted by {q.accepted_name ?? "the client"} on {formatDateTime(q.accepted_at)}. Their contracted prices now come from this quotation.
        </Banner>
      ) : q.declined_at ? (
        <Banner tone="danger">
          Declined on {formatDateTime(q.declined_at)}
          {q.declined_reason ? `: ${q.declined_reason}` : "."}
        </Banner>
      ) : q.status === "expired" ? (
        <Banner tone="warning">This quotation has expired. Make a new version to offer it again.</Banner>
      ) : q.rawStatus === "superseded" ? (
        <Banner tone="warning">A newer version replaced this one.</Banner>
      ) : null}

      <QuoteBuilder key={q.id} data={data} />

      <Surface>
        <SurfaceHeader title="History" description="Confirmations, emails, the client's views, questions and answer." />
        <QuoteTimeline events={data.events} />
      </Surface>
    </div>
  );
}

function Banner({ tone, children }: { tone: "success" | "danger" | "warning"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-xl px-4 py-3 text-sm ring-1",
        tone === "success" && "bg-success/10 text-success ring-success/20",
        tone === "danger" && "bg-destructive/10 text-destructive ring-destructive/20",
        tone === "warning" && "bg-warning/15 text-warning-foreground ring-warning/30 dark:text-warning",
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
