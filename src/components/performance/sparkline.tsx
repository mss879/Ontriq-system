import { cn } from "@/lib/utils";

/** A small line of daily values. Flat at the bottom when there is nothing yet. */
export function Sparkline({ values, label, className, width = 96, height = 24 }: { values: number[]; label: string; className?: string; width?: number; height?: number }) {
  const max = Math.max(0, ...values);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * (width - 2) + 1);
  const y = (v: number) => (max > 0 ? height - 2 - (v / max) * (height - 4) : height - 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${label}: ${total} in total`} className={cn("overflow-visible", className)}>
      {n > 1 ? (
        <>
          <polygon points={`1,${height - 1} ${points} ${width - 1},${height - 1}`} className="fill-primary/10" />
          <polyline points={points} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-primary" />
        </>
      ) : null}
      {n > 0 ? <circle cx={x(n - 1)} cy={y(values[n - 1])} r={2} className="fill-primary" /> : null}
    </svg>
  );
}

/** Daily bars for the drill-down. */
export function DayBars({ days, label }: { days: { day: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div role="img" aria-label={label} className="flex h-28 items-end gap-[3px]">
      {days.map((d) => (
        <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}: ${d.value}`}>
          <div className={cn("w-full rounded-t-sm", d.value ? "bg-primary/80 group-hover:bg-primary" : "bg-muted")} style={{ height: `${d.value ? Math.max(6, (d.value / max) * 100) : 4}%` }} />
        </div>
      ))}
    </div>
  );
}
