import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CircleAlert, Download } from "lucide-react";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/documents/document-preview";
import { QuoteStatusChip } from "@/components/quotes/quote-status";
import { PortalQuoteResponse } from "@/components/quotes/portal-quote-response";
import { MarkViewed } from "@/components/documents/mark-viewed";
import { markQuoteViewed } from "../actions";
import { getClientViewer } from "@/lib/server/viewer";
import { portalQuote, portalQuoteContext } from "@/lib/server/quotes/portal";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { quoteModel } from "@/domain/documents/model";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Quotation" };

export default function PortalQuotePage({ params }: PageProps<"/portal/quotes/[quoteId]">) {
  return (
    <Page className="max-w-5xl">
      <Link href="/portal/quotes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Quotes
      </Link>
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: Pick<PageProps<"/portal/quotes/[quoteId]">, "params">) {
  const [viewer, { quoteId }] = await Promise.all([getClientViewer(), params]);
  if (!can(viewer, "portal.quotes.accept")) redirect("/portal");
  const q = /^[0-9a-f-]{36}$/.test(quoteId) ? await portalQuote(quoteId) : null;
  if (!q) notFound();
  const ctx = await portalQuoteContext(q.id, viewer.orgId, viewer.clientId ?? "");
  const open = q.status === "sent" || q.status === "viewed";
  const model = quoteModel({
    issuer: ctx.issuer,
    client: ctx.client,
    contact: null,
    quote: { ...q, number: q.number, accepted_name: q.accepted_name, accepted_at: q.accepted_at },
    items: q.items,
    tiers: q.tiers,
  });

  return (
    <div className="space-y-6">
      {q.status === "sent" ? <MarkViewed markViewed={markQuoteViewed.bind(null, q.id)} /> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Quotation {q.number}</h1>
            <QuoteStatusChip status={q.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {q.title} · {formatMoney(q.total, q.currency)} · valid until {formatPlainDate(q.valid_until)}
          </p>
        </div>
        {ctx.documentId ? (
          <Button asChild variant="outline" size="lg" className="h-10">
            <a href={`/api/documents/${ctx.documentId}?download=1`}>
              <Download /> Download PDF
            </a>
          </Button>
        ) : null}
      </div>

      {q.status === "accepted" ? (
        <Note tone="success">
          Accepted by {q.accepted_name ?? "your team"} on {formatDateTime(q.accepted_at)}. These prices now apply to your requests.
        </Note>
      ) : q.status === "declined" ? (
        <Note tone="danger">You declined this quotation{q.declined_reason ? `: ${q.declined_reason}` : "."}</Note>
      ) : q.status === "expired" ? (
        <Note tone="warning">This quotation has expired. Ask Ontriq for a new one.</Note>
      ) : null}

      <div className="rounded-2xl bg-muted/30 p-3 ring-1 ring-foreground/[0.05] sm:p-6">
        <DocumentPreview model={model} template={q.template_key} />
      </div>

      <div className="sticky bottom-3 z-10 rounded-2xl bg-background/90 p-3 shadow-lift ring-1 ring-foreground/10 backdrop-blur sm:static sm:bg-transparent sm:p-0 sm:shadow-none sm:ring-0">
        <PortalQuoteResponse quoteId={q.id} number={q.number} clientName={q.client_name} total={formatMoney(q.total, q.currency)} open={open && q.can_accept} />
      </div>
    </div>
  );
}

function Note({ tone, children }: { tone: "success" | "danger" | "warning"; children: React.ReactNode }) {
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
