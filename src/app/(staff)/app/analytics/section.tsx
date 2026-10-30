import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { SectionSkeleton } from "@/components/layout/page";
import { cn } from "@/lib/utils";
import type { Period } from "@/domain/analytics/period";

/** The period and client the page is showing, plus the query string that encodes them. */
export type AnalyticsScope = { period: Period; client: string | null; query: string };

/** A titled card for one chart or table. */
export function Panel({ title, description, aside, children, className }: { title: string; description?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Surface className={className}>
      <SurfaceHeader title={title} description={description} aside={aside} />
      <div className="p-5">{children}</div>
    </Surface>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function PanelSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return <SectionSkeleton rows={rows} className={cn("min-h-56", className)} />;
}

export const GRID_2 = "grid gap-6 lg:grid-cols-2";
