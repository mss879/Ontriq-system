import Link from "next/link";
import { X } from "lucide-react";

export type FilterChip = { key: string; label: string; href: string };

/** What the list is filtered by right now. Each chip removes one filter; Clear removes them all. */
export function FilterChips({ chips, clearHref }: { chips: FilterChip[]; clearHref: string }) {
  if (!chips.length) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <li key={c.key}>
          <Link
            href={c.href}
            scroll={false}
            aria-label={`Remove filter: ${c.label}`}
            className="group inline-flex h-6 max-w-64 items-center gap-1 rounded-full bg-primary/[0.08] pr-1.5 pl-2.5 text-xs font-medium text-primary outline-none hover:bg-primary/[0.14] focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-sky"
          >
            <span className="truncate">{c.label}</span>
            <X aria-hidden className="size-3 shrink-0 opacity-60 group-hover:opacity-100" />
          </Link>
        </li>
      ))}
      <li>
        <Link href={clearHref} scroll={false} className="rounded px-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          Clear all
        </Link>
      </li>
    </ul>
  );
}
