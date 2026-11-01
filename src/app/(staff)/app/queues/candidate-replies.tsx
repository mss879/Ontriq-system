import Link from "@/components/link";
import { ArrowRight, FileSignature, MessageCircleReply } from "lucide-react";
import type { CandidateReply } from "@/lib/server/cases/candidate-queries";
import { RelativeTime } from "@/components/cases/sla-badge";
import { QueueEmpty } from "./queue-empty";

/** Answers, uploads for requests and consents the candidate sent, waiting for someone to look. Oldest first. */
export function CandidateReplies({ replies }: { replies: CandidateReply[] }) {
  if (!replies.length) return <QueueEmpty text="No candidate replies waiting. Answers and signed consents appear here." />;
  return (
    <ul className="divide-y overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      {replies.map((r) => {
        const Icon = r.kind === "consent" ? FileSignature : MessageCircleReply;
        return (
          <li key={`${r.kind}:${r.id}`}>
            <Link href={`/app/cases/${r.caseId}#candidate`} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary dark:text-brand-sky">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold text-primary group-hover:underline dark:text-brand-sky">{r.reference}</span>
                  <span className="truncate text-sm font-medium">{r.candidateName}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {r.title}
                  {r.at ? (
                    <>
                      {" · "}
                      <RelativeTime iso={r.at} />
                    </>
                  ) : null}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
