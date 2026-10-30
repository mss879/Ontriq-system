import Link from "next/link";
import { Briefcase, ChevronRight, ClipboardCheck, Globe, GraduationCap, IdCard, MapPin, Shield, Users } from "lucide-react";
import type { CaseCheck } from "@/lib/server/cases/queries";
import { completion } from "@/domain/check-types/validate";
import { CheckStatePill, ToneChip } from "@/components/cases/badges";
import { PersonChip } from "@/components/cases/person";
import { SlaBadge } from "@/components/cases/sla-badge";
import { CHECK_STATE_LABELS, isTerminalCheck } from "@/domain/workflow/stages";

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

const TONE = { green: "success", amber: "warning", red: "danger" } as const;

export function CheckCards({ caseId, checks, receivedAt }: { caseId: string; checks: CaseCheck[]; receivedAt: string }) {
  if (!checks.length) return <p className="text-sm text-muted-foreground">This case has no checks.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {checks.map((k) => {
        const filled = completion(k.schema.fields, k.values);
        const option = k.schema.result.options.find((o) => o.key === k.result);
        const pct = filled.required ? Math.round((filled.filled / filled.required) * 100) : 100;
        return (
          <li key={k.id}>
            <Link
              href={`/app/cases/${caseId}/checks/${k.id}`}
              className="group block h-full rounded-xl border bg-background/40 p-4 transition-colors outline-none hover:border-foreground/20 hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
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
                    {option && k.resultTone && option.label !== CHECK_STATE_LABELS[k.state] ? <ToneChip tone={TONE[k.resultTone]}>{option.label}</ToneChip> : null}
                    {!isTerminalCheck(k.state) ? <SlaBadge dueAt={k.dueAt} startedAt={k.startedAt ?? receivedAt} compact /> : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                <PersonChip person={k.assignee} />
                <div className="flex shrink-0 items-center gap-2" title={`${filled.filled} of ${filled.required} required details filled`}>
                  <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className={k.valuesValid ? "h-full rounded-full bg-success" : "h-full rounded-full bg-brand-blue dark:bg-brand-sky"} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {k.valuesValid ? "Complete" : `${filled.filled}/${filled.required}`}
                    <span className="sr-only"> required details filled</span>
                  </span>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
