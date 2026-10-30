import { ToneChip } from "@/components/cases/badges";
import { formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_TONE, type QuoteEvent, type QuoteStatus } from "./types";

export function QuoteStatusChip({ status, className }: { status: QuoteStatus; className?: string }) {
  return (
    <ToneChip tone={QUOTE_STATUS_TONE[status]} className={className}>
      {QUOTE_STATUS_LABELS[status]}
    </ToneChip>
  );
}

const EVENT_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  sent: "Sent",
  viewed: "Opened by the client",
  accepted: "Accepted",
  declined: "Declined",
  question: "Question from the client",
  revised: "New version started",
};

/** The quotation's history, newest first. */
export function QuoteTimeline({ events }: { events: QuoteEvent[] }) {
  if (!events.length) return <p className="px-5 py-4 text-sm text-muted-foreground">Nothing has happened yet.</p>;
  return (
    <ol className="divide-y">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 px-5 py-3">
          <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${e.kind === "accepted" ? "bg-success" : e.kind === "declined" ? "bg-destructive" : e.kind === "question" ? "bg-warning" : "bg-brand-blue dark:bg-brand-sky"}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind}</span>
              <span className="text-muted-foreground"> · {e.actor}</span>
            </p>
            {e.body ? <p className="mt-0.5 text-sm break-words whitespace-pre-line text-muted-foreground">{e.body}</p> : null}
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{formatDateTime(e.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
