import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileSignature } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { QuoteStatusChip } from "@/components/quotes/quote-status";
import { getClientViewer } from "@/lib/server/viewer";
import { portalQuotes } from "@/lib/server/quotes/portal";
import { formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { can } from "@/domain/permissions";

export const metadata: Metadata = { title: "Quotes" };

const DESCRIPTION = "Quotations from Ontriq. Read them, download the PDF, and accept, decline or ask a question.";

export default function PortalQuotesPage() {
  return (
    <Page>
      <PageHeader eyebrow="Commercial" title="Quotes" description={DESCRIPTION} />
      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <List />
      </Suspense>
    </Page>
  );
}

async function List() {
  const viewer = await getClientViewer();
  if (!can(viewer, "portal.quotes.accept")) redirect("/portal");
  const quotes = await portalQuotes();
  if (!quotes.length) {
    return (
      <div className="rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSignature />
            </EmptyMedia>
            <EmptyTitle>No quotations yet</EmptyTitle>
            <EmptyDescription>When Ontriq sends you a quotation it appears here and you get an email.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  const waiting = quotes.filter((q) => q.status === "sent" || q.status === "viewed");
  return (
    <div className="space-y-3">
      {waiting.length ? (
        <p className="rounded-xl bg-brand-orange/10 px-4 py-2.5 text-sm text-brand-orange-ink ring-1 ring-brand-orange/20">
          {waiting.length === 1 ? "One quotation is" : `${waiting.length} quotations are`} waiting for your answer.
        </p>
      ) : null}
      <ul className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
        {quotes.map((q, i) => (
          <li key={q.id} className={i ? "border-t" : undefined}>
            <Link href={`/portal/quotes/${q.id}`} className="group flex items-center gap-4 px-5 py-4 hover:bg-muted/40">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
                <FileSignature className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium group-hover:underline">
                  {q.number}
                  {q.version > 1 ? ` v${q.version}` : ""} · {q.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  Valid until {formatPlainDate(q.valid_until)}
                  {q.accepted_at ? ` · accepted by ${q.accepted_name ?? "your team"}` : ""}
                </span>
              </span>
              <span className="hidden text-right sm:block">
                <span className="block font-semibold tabular-nums">{formatMoney(q.total, q.currency)}</span>
              </span>
              <QuoteStatusChip status={q.status} />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
