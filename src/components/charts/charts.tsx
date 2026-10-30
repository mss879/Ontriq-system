import { cn } from "@/lib/utils";

/**
 * Small, dependency-free charts drawn with HTML and inline SVG. Colours come
 * from the theme tokens (--chart-1…5 and the status colours), so light and
 * dark mode both work. Every chart carries an accessible label and a hidden
 * table of its values for screen readers. Server-renderable.
 */

export type Series = { key: string; label: string; color: string };
export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
export const TONE_COLORS = { green: "var(--success)", amber: "var(--warning)", red: "var(--destructive)", slate: "var(--muted-foreground)", blue: "var(--chart-1)" } as const;

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

function SrTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; value?: string }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          <span>{i.label}</span>
          {i.value ? <span className="font-medium text-foreground tabular-nums">{i.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Vertical columns, one group per category, one bar per series. Labels thin
 * out automatically when there are many categories.
 */
export function ColumnChart({
  title,
  categories,
  series,
  values,
  format = (n) => String(n),
  axisFormat = format,
  height = 176,
  className,
}: {
  title: string;
  categories: string[];
  series: Series[];
  values: number[][]; // values[seriesIndex][categoryIndex]
  format?: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  className?: string;
}) {
  const max = niceMax(Math.max(0, ...values.flat()));
  const every = Math.max(1, Math.ceil(categories.length / 8));
  return (
    <figure className={cn("space-y-3", className)}>
      <div role="img" aria-label={`${title}: chart`} className="flex gap-2">
        <div className="flex w-9 shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums" style={{ height }}>
          <span>{axisFormat(max)}</span>
          <span>{axisFormat(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative flex items-end gap-[3px] border-b border-border" style={{ height }}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/70" />
            {categories.map((c, ci) => (
              <div key={`${c}-${ci}`} className="relative flex h-full min-w-0 flex-1 items-end justify-center gap-px">
                {series.map((s, si) => {
                  const v = values[si]?.[ci] ?? 0;
                  return (
                    <div
                      key={s.key}
                      title={`${c} · ${s.label}: ${format(v)}`}
                      className="w-full max-w-7 rounded-t-[3px] transition-opacity hover:opacity-80"
                      style={{ height: `${(100 * v) / max}%`, minHeight: v > 0 ? 2 : 0, background: s.color }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[3px] text-[10px] text-muted-foreground">
            {categories.map((c, ci) => (
              <span key={`${c}-${ci}`} className="min-w-0 flex-1 truncate text-center">
                {ci % every === 0 ? c : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      {series.length > 1 ? <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} className="pl-11" /> : null}
      <SrTable caption={title} columns={["", ...series.map((s) => s.label)]} rows={categories.map((c, ci) => [c, ...series.map((_, si) => format(values[si]?.[ci] ?? 0))])} />
    </figure>
  );
}

/** A line (with a soft area) over many points, e.g. daily cost. */
export function LineChart({
  title,
  points,
  color = "var(--chart-1)",
  format = (n) => String(n),
  height = 160,
  className,
}: {
  title: string;
  points: { label: string; value: number }[];
  color?: string;
  format?: (n: number) => string;
  height?: number;
  className?: string;
}) {
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 50 : (100 * i) / (n - 1));
  const y = (v: number) => 100 - (100 * v) / max;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const area = n ? `${line} L${x(n - 1).toFixed(2)},100 L${x(0).toFixed(2)},100 Z` : "";
  const ticks = n ? [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i) : [];
  return (
    <figure className={cn("space-y-1.5", className)}>
      <div role="img" aria-label={`${title}: chart`} className="flex gap-2">
        <div className="flex w-12 shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums" style={{ height }}>
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>{format(0)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full overflow-visible border-b border-border" style={{ height }} aria-hidden>
            <line x1="0" x2="100" y1="0" y2="0" className="stroke-border" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="100" y1="50" y2="50" className="stroke-border" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            {n ? <path d={area} fill={color} opacity={0.12} /> : null}
            {n ? <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /> : null}
          </svg>
          <div className="relative mt-1.5 h-3 text-[10px] text-muted-foreground">
            {ticks.map((i) => (
              <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full" style={{ left: `${x(i)}%` }}>
                {points[i].label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <SrTable caption={title} columns={["", "Value"]} rows={points.map((p) => [p.label, format(p.value)])} />
    </figure>
  );
}

/** Ranked horizontal bars with the value at the end, e.g. top clients. */
export function BarList({
  title,
  items,
  format = (n) => String(n),
  color = "var(--chart-1)",
  className,
}: {
  title: string;
  items: { label: string; value: number; href?: string; detail?: string; color?: string }[];
  format?: (n: number) => string;
  color?: string;
  className?: string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value)) || 1;
  return (
    <figure className={cn("space-y-2.5", className)} aria-label={title}>
      <ul className="space-y-2.5">
        {items.map((i) => (
          <li key={i.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              {i.href ? (
                <a href={i.href} className="min-w-0 truncate hover:underline">
                  {i.label}
                </a>
              ) : (
                <span className="min-w-0 truncate">{i.label}</span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {i.detail ? <span className="mr-2">{i.detail}</span> : null}
                <span className="font-medium text-foreground">{format(i.value)}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${(100 * i.value) / max}%`, minWidth: i.value > 0 ? 3 : 0, background: i.color ?? color }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** One horizontal bar split into parts, with a legend, e.g. receivables by age. */
export function StackedBar({
  title,
  parts,
  format = (n) => String(n),
  className,
}: {
  title: string;
  parts: { label: string; value: number; color: string }[];
  format?: (n: number) => string;
  className?: string;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <figure className={cn("space-y-3", className)}>
      <div role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`} className="flex h-3 overflow-hidden rounded-full bg-muted">
        {total
          ? parts.map((p) =>
              p.value > 0 ? (
                <div
                  key={p.label}
                  title={`${p.label}: ${format(p.value)}`}
                  className="h-full border-r-2 border-card last:border-r-0"
                  style={{ width: `${(100 * p.value) / total}%`, background: p.color }}
                />
              ) : null,
            )
          : null}
      </div>
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color, value: format(p.value) }))} />
    </figure>
  );
}

/** A ring chart with the total in the middle. */
export function Donut({
  title,
  parts,
  centerLabel,
  format = (n) => String(n),
  size = 132,
  className,
}: {
  title: string;
  parts: { label: string; value: number; color: string }[];
  centerLabel?: string;
  format?: (n: number) => string;
  size?: number;
  className?: string;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 15.9155; // circumference 100
  let offset = 25;
  return (
    <figure className={cn("flex flex-col items-center gap-4 sm:flex-row sm:items-center", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" className="size-full" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`}>
          <circle cx="21" cy="21" r={r} fill="none" className="stroke-muted" strokeWidth="5" />
          {total
            ? parts.map((p) => {
                if (!p.value) return null;
                const len = (100 * p.value) / total;
                const el = (
                  <circle key={p.label} cx="21" cy="21" r={r} fill="none" stroke={p.color} strokeWidth="5" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={offset}>
                    <title>{`${p.label}: ${format(p.value)}`}</title>
                  </circle>
                );
                offset -= len;
                return el;
              })
            : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-xl font-semibold tabular-nums">{format(total)}</span>
          {centerLabel ? <span className="text-[10px] text-muted-foreground">{centerLabel}</span> : null}
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              <span className="font-medium text-foreground">{format(p.value)}</span>
              {total ? <span className="ml-1.5 text-xs">{Math.round((100 * p.value) / total)}%</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A tiny trend line for table rows and tiles. */
export function Sparkline({ values, color = "var(--chart-1)", label, className }: { values: number[]; color?: string; label: string; className?: string }) {
  const max = Math.max(0, ...values) || 1;
  const n = values.length;
  const pts = values.map((v, i) => `${n <= 1 ? 50 : (100 * i) / (n - 1)},${30 - (28 * v) / max - 1}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-6 w-20", className)} role="img" aria-label={`${label}: ${values.join(", ")}`}>
      {n ? <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /> : null}
    </svg>
  );
}
