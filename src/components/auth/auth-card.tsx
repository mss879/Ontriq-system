export function AuthCard({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="w-full max-w-[400px] animate-rise">
      <div className="mb-8 space-y-2.5">
        <h1 className="font-display text-[2rem] leading-tight font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children}
      {footer ? <div className="mt-8 border-t pt-6 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

export function AuthFormSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="w-full max-w-[400px] space-y-6" aria-hidden>
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-muted" />
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
      <div className="h-10 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
