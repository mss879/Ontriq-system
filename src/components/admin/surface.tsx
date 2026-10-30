import { cn } from "@/lib/utils";

/** The one card recipe. `Surface` renders it; use the constant only for a link or button that is itself a card. */
export const SURFACE = "rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]";

export function Surface({ children, className, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("overflow-hidden", SURFACE, className)} {...props}>
      {children}
    </section>
  );
}

export function SurfaceHeader({ title, description, aside, className }: { title: React.ReactNode; description?: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}

export const TH = "h-9 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase";
