"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { FilterChips, type FilterChip } from "@/components/admin/filter-chips";
import { DateField } from "@/components/forms/date-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type FilterSelect = { name: string; label: string; options: { value: string; label: string }[]; allLabel?: string; className?: string };

/** Search box (debounced) and select filters that live in the URL. */
export function ListFilters({ placeholder, selects = [], dates = [], className }: { placeholder?: string; selects?: FilterSelect[]; dates?: { name: string; label: string }[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const push = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.delete("page");
    const qs = sp.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const without = (name: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.delete(name);
    sp.delete("page");
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const chips: FilterChip[] = [
    ...selects.flatMap((s) => {
      const value = params.get(s.name);
      const option = s.options.find((o) => o.value === value);
      return option ? [{ key: s.name, label: option.label, href: without(s.name) }] : [];
    }),
    ...dates.flatMap((d) => {
      const value = params.get(d.name);
      return value ? [{ key: d.name, label: `${d.label} ${value}`, href: without(d.name) }] : [];
    }),
  ];

  return (
    <div className={cn("space-y-2", className)}>
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {placeholder ? (
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            const value = e.target.value;
            setQ(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => push({ q: value.trim() || null }), 300);
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 pr-8 pl-9"
        />
        {pending ? (
          <Spinner className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        ) : q ? (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQ("");
              push({ q: null });
            }}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      ) : null}
      {selects.map((s) => (
        <Select key={s.name} value={params.get(s.name) ?? "__all"} onValueChange={(v) => push({ [s.name]: v === "__all" ? null : v })}>
          <SelectTrigger className={cn("h-9 w-full sm:w-44", s.className)} aria-label={s.label}>
            <SelectValue placeholder={s.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{s.allLabel ?? `All ${s.label.toLowerCase()}`}</SelectItem>
            {s.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {dates.map((d) => (
        <label key={d.name} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{d.label}</span>
          <DateField
            key={params.get(d.name) ?? ""}
            wrapperClassName="w-full sm:w-40"
            className="h-9"
            defaultValue={params.get(d.name) ?? ""}
            onChange={(e) => push({ [d.name]: e.target.value || null })}
          />
        </label>
      ))}
    </div>
    <FilterChips chips={chips} clearHref={pathname} />
    </div>
  );
}
