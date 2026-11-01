"use client";

import { useState, useTransition } from "react";
import Link from "@/components/link";
import { BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { acknowledgeNudge } from "@/app/(staff)/app/team/performance/actions";
import type { NudgeRow } from "@/lib/server/performance/queries";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Colombo" }).format(new Date(iso));

/** Pushes the viewer hasn't acknowledged: the items, the message, Acknowledge and a short reply. */
export function NudgeBanner({ nudges, highlight }: { nudges: NudgeRow[]; highlight?: string | null }) {
  return (
    <section aria-label="Pushes from your manager" className="space-y-3">
      {nudges.map((n) => (
        <NudgeCard key={n.id} nudge={n} highlighted={n.id === highlight} />
      ))}
    </section>
  );
}

function NudgeCard({ nudge, highlighted }: { nudge: NudgeRow; highlighted: boolean }) {
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [pending, start] = useTransition();
  const count = nudge.items.length;
  const overdue = nudge.items.filter((i) => i.overdue).length;

  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl bg-destructive/[0.06] p-4 ring-1 ring-destructive/25 md:p-5 dark:bg-destructive/10",
        highlighted && "ring-2 ring-destructive/50",
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/12 text-destructive">
            <BellRing className="size-[18px]" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-semibold">
              {count ? `You're behind on ${count} item${count === 1 ? "" : "s"}` : "A push from your manager"}
              {overdue && overdue !== count ? <span className="font-normal text-muted-foreground"> · {overdue} overdue</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {nudge.auto ? "Sent automatically" : `From ${nudge.fromName ?? "your manager"}`} · {when(nudge.createdAt)}
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-line">{nudge.message}</p>
            {count ? (
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {nudge.items.slice(0, 8).map((i) => (
                  <li key={`${i.kind}-${i.id}`}>
                    <Link
                      href={`/app/cases/${i.case_id}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs ring-1 transition-colors hover:bg-muted",
                        i.overdue ? "ring-destructive/30" : "ring-foreground/10",
                      )}
                    >
                      <span className="font-medium">{i.reference}</span>
                      <span className="max-w-48 truncate text-muted-foreground">{i.label}</span>
                    </Link>
                  </li>
                ))}
                {count > 8 ? <li className="self-center text-xs text-muted-foreground">and {count - 8} more</li> : null}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!replying ? (
            <Button variant="ghost" size="sm" onClick={() => setReplying(true)} disabled={pending}>
              Reply
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await acknowledgeNudge({ id: nudge.id, reply: reply.trim() || undefined });
                if (res.ok) toast.success(reply.trim() ? "Acknowledged and replied" : "Acknowledged");
                else toast.error(res.error);
              })
            }
          >
            {pending ? <Spinner /> : <Check />} {replying && reply.trim() ? "Send and acknowledge" : "Acknowledge"}
          </Button>
        </div>
      </div>
      {replying ? (
        <div className="mt-3 md:pl-12">
          <Textarea
            rows={2}
            maxLength={500}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="What's holding things up, or what help you need (optional)"
            aria-label="Reply"
            autoFocus
          />
        </div>
      ) : null}
    </div>
  );
}
