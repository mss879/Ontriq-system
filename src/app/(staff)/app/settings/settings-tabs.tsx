"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsTabs({ items }: { items: { title: string; href: string }[] }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/app/settings" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Settings" className="mx-auto flex h-12 w-full max-w-6xl items-end gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:px-8 [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active(item.href) ? "page" : undefined}
          className={cn(
            "relative shrink-0 rounded-t-lg px-3 pt-2 pb-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
            active(item.href) && "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:rounded-full after:bg-brand-orange",
          )}
        >
          {item.title}
        </Link>
      ))}
    </nav>
  );
}
