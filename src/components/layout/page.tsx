import { cn } from "@/lib/utils";

/** Standard page container used by every screen. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-5 md:px-8 md:py-7", className)}>{children}</div>;
}

/** The website's section label: a short orange bar and spaced capitals. */
export function Eyebrow({ children, className, tone = "default" }: { children: React.ReactNode; className?: string; tone?: "default" | "onDark" }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.28em] uppercase",
        tone === "onDark" ? "text-white/60" : "text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className="h-[3px] w-6 rounded-full bg-brand-orange" />
      {children}
    </p>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-balance md:text-[1.75rem]">{title}</h1>
        {description ? <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div> : null}
    </div>
  );
}

export function SectionSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]", className)} aria-hidden>
      <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3.5 animate-pulse rounded-md bg-muted" style={{ width: `${85 - i * 12}%` }} />
      ))}
    </div>
  );
}
