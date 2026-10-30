"use client";

import { useTransition } from "react";
import { ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { decideSuggestion } from "@/app/(staff)/app/cases/[caseId]/ai-actions";
import type { DocumentAi } from "@/lib/server/ai/queries";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const ISSUE: Record<string, string> = {
  blurred: "blurred",
  cropped: "cropped",
  too_dark: "too dark",
  glare: "glare",
  rotated: "rotated",
  low_resolution: "low resolution",
  missing_pages: "pages missing",
  other: "other problem",
};

/** What the classifier made of a file: its type, quality problems and possible editing. Opens to explain and dismiss. */
export function DocumentAiChip({ ai, typeName, canDismiss }: { ai: DocumentAi; typeName: (key: string) => string; canDismiss: boolean }) {
  const [pending, start] = useTransition();
  const problems = [
    ...(ai.readable === false ? ["hard to read"] : []),
    ...(ai.matchesExpected === false && ai.type ? [`looks like ${typeName(ai.type).toLowerCase()}`] : []),
    ...ai.issues.map((i) => ISSUE[i] ?? i.replace(/_/g, " ")),
  ];
  const tone = ai.possibleTampering ? "danger" : problems.length ? "warning" : "neutral";
  const label = ai.possibleTampering ? "Check for editing" : problems.length ? (problems.length === 1 ? capital(problems[0]) : `${problems.length} quality issues`) : ai.type ? typeName(ai.type) : "Read by AI";
  const flagIds = [ai.qualitySuggestionId, ai.tamperSuggestionId].filter((x): x is string => Boolean(x));

  const dismiss = () =>
    start(async () => {
      for (const id of flagIds) {
        const r = await decideSuggestion(id, "rejected");
        if (!r.ok) return void toast.error(r.error);
      }
      toast.success("AI flag dismissed");
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-5 max-w-[12rem] items-center gap-1 rounded-full px-2 text-[11px] font-medium ring-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            tone === "danger" && "bg-destructive/10 text-destructive ring-destructive/20",
            tone === "warning" && "bg-warning/15 text-warning-foreground ring-warning/30 dark:text-warning",
            tone === "neutral" && "bg-brand-blue/10 text-brand-blue ring-brand-blue/20 dark:bg-brand-sky/10 dark:text-brand-sky dark:ring-brand-sky/25",
          )}
          aria-label={`AI check of this file: ${label}`}
        >
          {ai.possibleTampering ? <ShieldAlert className="size-3 shrink-0" aria-hidden /> : <Sparkles className="size-3 shrink-0" aria-hidden />}
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 text-sm">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden /> AI suggested · a person decides
        </p>
        <dl className="space-y-1">
          {ai.type ? <Row k="Looks like" v={typeName(ai.type)} /> : null}
          {ai.readable !== null ? <Row k="Readable" v={ai.readable ? "Yes" : "No"} /> : null}
          {ai.matchesExpected !== null ? <Row k="Right document" v={ai.matchesExpected ? "Yes" : "Maybe not"} /> : null}
          {ai.issues.length ? <Row k="Quality" v={ai.issues.map((i) => ISSUE[i] ?? i).join(", ")} /> : null}
          {ai.language ? <Row k="Language" v={ai.language === "si" ? "Sinhala" : ai.language === "ta" ? "Tamil" : ai.language === "en" ? "English" : ai.language} /> : null}
        </dl>
        {ai.possibleTampering ? (
          <p className="rounded-lg bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
            Possible signs of editing{ai.tamperNotes ? `: ${ai.tamperNotes}` : "."} This is not proof; compare with the original or the source.
          </p>
        ) : null}
        {ai.candidateMessage ? <p className="text-xs text-muted-foreground">Suggested message to the sender: “{ai.candidateMessage}”</p> : null}
        {canDismiss && flagIds.length ? (
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={pending} className="-ml-2">
            <X /> Dismiss the flag
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 text-xs">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
