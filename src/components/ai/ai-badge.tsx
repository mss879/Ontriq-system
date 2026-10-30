import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { confidenceLabel } from "@/domain/ai/suggestions";

/** Marks anything the AI produced. Nothing carrying it has been applied without a person. */
export function AiBadge({ confidence, label = "AI suggested", className }: { confidence?: number | null; label?: string; className?: string }) {
  const conf = confidenceLabel(confidence);
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-brand-blue/10 px-2 text-[11px] font-medium whitespace-nowrap text-brand-blue ring-1 ring-brand-blue/20 dark:bg-brand-sky/10 dark:text-brand-sky dark:ring-brand-sky/25",
        className,
      )}
      title={conf ? `Confidence: ${conf}` : undefined}
    >
      <Sparkles className="size-3" aria-hidden />
      {label}
      {conf ? <span className="font-normal opacity-80">· {conf}</span> : null}
    </span>
  );
}

/** The quiet line shown instead of AI panels when nothing can run. */
export function AiOffNote({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Sparkles className="size-3.5 shrink-0" aria-hidden />
      {children ?? "AI isn't set up, so suggestions won't appear here. Everything works without it."}
    </p>
  );
}
