import Link from "@/components/link";
import { Briefcase, ChevronRight, ClipboardCheck, Globe, GraduationCap, IdCard, MapPin, Shield, Sparkles, Users } from "lucide-react";
import type { CaseCheck } from "@/lib/server/cases/queries";
import { missingDetails } from "@/domain/ai/extraction";
import { completion, modeAt } from "@/domain/check-types/validate";
import { CheckStatePill, RESULT_TONE, TONE_CLASSES, ToneChip } from "@/components/cases/badges";
import { PersonAvatar, PersonChip } from "@/components/cases/person";
import { SlaBadge } from "@/components/cases/sla-badge";
import { CHECK_STATE_LABELS, CHECK_STATE_TONES, isTerminalCheck, type Stage } from "@/domain/workflow/stages";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  "map-pin": MapPin,
  shield: Shield,
  "id-card": IdCard,
  users: Users,
  globe: Globe,
};

export function CheckIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? ClipboardCheck;
  return <Icon className={className} />;
}

export function CheckCards({
  caseId,
  checks,
  stage,
  receivedAt,
  found = {},
  ownerId = null,
}: {
  caseId: string;
  checks: CaseCheck[];
  stage: Stage;
  receivedAt: string;
  /** Details the AI read per check, waiting to be confirmed. */
  found?: Record<string, number>;
  /** The case owner, named in the side panel: their checks show just their face. */
  ownerId?: string | null;
}) {
  const mode = modeAt(stage);
  if (!checks.length) return <p className="text-sm text-muted-foreground">This case has no checks.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {checks.map((k) => {
        const filled = completion(k.schema.fields, k.values, mode);
        const option = k.schema.result.options.find((o) => o.key === k.result);
        const pct = filled.required ? Math.round((filled.filled / filled.required) * 100) : 100;
        const missing = isTerminalCheck(k.state) ? [] : missingDetails(k.schema.fields, k.values, mode);
        const complete = missing.length === 0;
        // A check with nothing for Data Entry, such as Global Sanction, has nothing to show until verification.
        const notYet = mode === "entry" && filled.required === 0;
        return (
          <li key={k.id} className="min-w-0">
            <Link
              href={`/app/cases/${caseId}/checks/${k.id}`}
              className="group relative block h-full overflow-hidden rounded-xl border bg-background/40 p-4 pl-5 transition-colors outline-none hover:border-foreground/20 hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", TONE_CLASSES[k.resultTone ? RESULT_TONE[k.resultTone] : CHECK_STATE_TONES[k.state]].dot)} />
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue dark:bg-brand-sky/10 dark:text-brand-sky">
                  <CheckIcon icon={k.icon} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{k.label}</p>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <CheckStatePill state={k.state} />
                    {option && k.resultTone && option.label !== CHECK_STATE_LABELS[k.state] ? <ToneChip tone={RESULT_TONE[k.resultTone]}>{option.label}</ToneChip> : null}
                    {!isTerminalCheck(k.state) ? <SlaBadge dueAt={k.dueAt} startedAt={k.startedAt ?? receivedAt} compact /> : null}
                    {found[k.id] ? (
                      <ToneChip tone="progress" dot={false}>
                        <Sparkles className="size-3" aria-hidden /> {found[k.id]} found by AI
                      </ToneChip>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                {k.assignee && k.assignee.id === ownerId ? (
                  <span title={`${k.assignee.name}, the case owner`}>
                    <PersonAvatar id={k.assignee.id} name={k.assignee.name} size="sm" />
                    <span className="sr-only">{k.assignee.name}, the case owner</span>
                  </span>
                ) : (
                  <PersonChip person={k.assignee} />
                )}
                {notYet ? (
                  <span className="shrink-0 text-xs text-muted-foreground">Done at verification</span>
                ) : (
                  <div className="flex shrink-0 items-center gap-2" title={`${filled.filled} of ${filled.required} required details filled`}>
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className={complete ? "h-full rounded-full bg-success" : "h-full rounded-full bg-brand-blue dark:bg-brand-sky"} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {complete ? "Complete" : `${filled.filled}/${filled.required}`}
                      <span className="sr-only"> required details filled</span>
                    </span>
                  </div>
                )}
              </div>
              {missing.length ? (
                <p className="mt-2 truncate text-xs text-muted-foreground" title={missing.join(", ")}>
                  Still needed: {missing.slice(0, 3).join(", ")}
                  {missing.length > 3 ? ` +${missing.length - 3}` : ""}
                </p>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
