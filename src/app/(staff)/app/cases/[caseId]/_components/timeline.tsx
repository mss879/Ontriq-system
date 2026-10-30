"use client";

import { useState, useTransition } from "react";
import {
  ArrowRight,
  Ban,
  Check,
  ClipboardCheck,
  Eye,
  Inbox,
  MailQuestion,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  ShieldCheck,
  Sparkles,
  Undo2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { addCaseNote } from "../../actions";
import type { TimelineEvent } from "@/lib/server/cases/queries";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  created: Inbox,
  stage_changed: ArrowRight,
  returned: Undo2,
  assigned: UserRound,
  check_state: ClipboardCheck,
  document_uploaded: Upload,
  document_accepted: Check,
  document_rejected: X,
  document_requested: MailQuestion,
  document_visibility: Eye,
  requirement_waived: Ban,
  note: MessageSquare,
  hold: Pause,
  resumed: Play,
  cancelled: Ban,
  qc_pre: ShieldCheck,
  qc_post: ShieldCheck,
  details_updated: Pencil,
  ai_read: Sparkles,
};

const TONE: Record<string, string> = {
  returned: "bg-warning/15 text-warning-foreground dark:text-warning",
  document_rejected: "bg-destructive/10 text-destructive",
  hold: "bg-warning/15 text-warning-foreground dark:text-warning",
  note: "bg-brand-orange/10 text-brand-orange-ink dark:text-brand-orange",
  qc_pre: "bg-brand-blue/10 text-brand-blue dark:text-brand-sky",
  qc_post: "bg-brand-blue/10 text-brand-blue dark:text-brand-sky",
  stage_changed: "bg-brand-blue/10 text-brand-blue dark:text-brand-sky",
  ai_read: "bg-brand-blue/10 text-brand-blue dark:text-brand-sky",
};

export function Timeline({
  caseId,
  checkId,
  events,
  checks,
  canNote,
}: {
  caseId: string;
  checkId?: string;
  events: TimelineEvent[];
  checks: { id: string; label: string }[];
  canNote: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = checkId ? events.filter((e) => e.caseCheckId === checkId) : events;
  const shown = showAll ? list : list.slice(0, 15);
  const checkLabel = (id: string | null) => (id ? checks.find((c) => c.id === id)?.label : undefined);

  return (
    <div className="space-y-5">
      {canNote ? <NoteComposer caseId={caseId} checkId={checkId} /> : null}
      {shown.length ? (
        <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
          {shown.map((e) => {
            const Icon = ICON[e.kind] ?? ArrowRight;
            const check = !checkId ? checkLabel(e.caseCheckId) : undefined;
            return (
              <li key={e.id} className="relative flex gap-3">
                <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", TONE[e.kind] ?? "bg-muted text-muted-foreground")}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="text-sm font-medium">{e.title}</p>
                    {check && !e.title.startsWith(check) ? <span className="text-xs text-muted-foreground">· {check}</span> : null}
                  </div>
                  {e.body ? <p className={cn("mt-0.5 text-sm whitespace-pre-line text-muted-foreground", e.kind === "note" && "rounded-lg bg-muted/50 px-3 py-2 text-foreground")}>{e.body}</p> : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{e.actor?.name ?? "System"}</span>
                    <span aria-hidden>·</span>
                    <RelativeTime iso={e.at} />
                    {e.visibleToClient ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] text-info">
                        <Eye className="size-3" /> Client sees
                      </span>
                    ) : null}
                    {e.visibleToCandidate ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-orange/10 px-2 py-0.5 text-[11px] text-brand-orange-ink dark:text-brand-orange">
                        <Eye className="size-3" /> Candidate sees
                      </span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing has happened here yet.</p>
      )}
      {list.length > 15 ? (
        <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${list.length}`}
        </Button>
      ) : null}
    </div>
  );
}

function NoteComposer({ caseId, checkId }: { caseId: string; checkId?: string }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        start(async () => {
          const r = await addCaseNote(caseId, checkId ?? null, body);
          if (r.ok) {
            setBody("");
            toast.success("Note added");
          } else toast.error(r.error);
        });
      }}
    >
      <label htmlFor={`note-${checkId ?? "case"}`} className="sr-only">
        Add a note
      </label>
      <Textarea
        id={`note-${checkId ?? "case"}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add an internal note. Only Ontriq staff see notes."
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">⌘ Enter to post</p>
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? <Spinner /> : <MessageSquare />} Add note
        </Button>
      </div>
    </form>
  );
}
