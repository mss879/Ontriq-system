"use client";

import { usePathname } from "next/navigation";
import { UnderlineTabs } from "@/components/layout/tabs";

export function SettingsTabs({ items }: { items: { title: string; href: string }[] }) {
  const pathname = usePathname();
  const matches = (href: string) => (href === "/app/settings" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <UnderlineTabs
      label="Settings"
      active={items.find((i) => matches(i.href))?.href ?? ""}
      items={items.map((i) => ({ key: i.href, label: i.title, href: i.href }))}
      className="mx-auto h-12 w-full max-w-6xl px-4 md:px-8"
    />
  );
}
