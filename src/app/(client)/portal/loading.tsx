import { Page, SectionSkeleton } from "@/components/layout/page";

/** Shown for a moment on navigation, until the page's own skeleton arrives. */
export default function Loading() {
  return (
    <Page>
      <div className="space-y-2" aria-hidden>
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
      </div>
      <SectionSkeleton rows={8} />
    </Page>
  );
}
