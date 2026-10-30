import Link from "next/link";
import { cn } from "@/lib/utils";

export type HeatRow = { userId: string; name: string; cells: { label: string; overdue: number }[] };

const shade = (v: number, max: number) => {
  if (v <= 0) return "bg-muted";
  const r = v / Math.max(1, max);
  if (r > 0.75) return "bg-destructive";
  if (r > 0.5) return "bg-destructive/70";
  if (r > 0.25) return "bg-brand-orange/70";
  return "bg-brand-orange/35";
};

/** People × days, shaded by items overdue at the end of each day. */
export function WorkloadHeatmap({ rows, weekly }: { rows: HeatRow[]; weekly: boolean }) {
  const max = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.overdue)));
  if (!rows.length) return <p className="px-5 py-8 text-center text-sm text-muted-foreground">No one to show yet.</p>;
  return (
    <div className="space-y-3 overflow-x-auto px-5 py-4">
      <table className="w-full border-separate border-spacing-y-1 text-sm">
        <caption className="sr-only">Items overdue at the end of each {weekly ? "week (worst day)" : "day"}, per person</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <th scope="row" className="w-40 max-w-40 truncate pr-3 text-left text-xs font-medium">
                <Link href={`/app/team/performance/${r.userId}`} className="hover:text-primary">
                  {r.name}
                </Link>
              </th>
              <td>
                <div className="flex gap-[3px]">
                  {r.cells.map((c) => (
                    <span key={c.label} title={`${c.label}: ${c.overdue} overdue`} aria-label={`${c.label}: ${c.overdue} overdue`} className={cn("h-5 min-w-2 flex-1 rounded-[4px]", shade(c.overdue, max))} />
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
        <span>None</span>
        {["bg-muted", "bg-brand-orange/35", "bg-brand-orange/70", "bg-destructive/70", "bg-destructive"].map((c) => (
          <span key={c} className={cn("size-3 rounded-[3px]", c)} />
        ))}
        <span>Most overdue{max ? ` (${max})` : ""}</span>
      </div>
    </div>
  );
}
