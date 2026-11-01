"use client";

import { useOptimistic, useTransition } from "react";
import Link from "@/components/link";
import { Bell, BellRing, CheckCheck, FileCheck2, FileSignature, FolderOpen, ListChecks, Megaphone, Receipt, RotateCcw, type LucideIcon } from "lucide-react";
import { markNotificationsRead } from "@/app/(staff)/app/notification-actions";
import type { NotificationItem } from "@/lib/server/admin/notifications";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

function iconFor(type: string): LucideIcon {
  if (type === "case.returned") return RotateCcw;
  if (type.startsWith("case.")) return FolderOpen;
  if (type.startsWith("check.")) return ListChecks;
  if (type.startsWith("nudge")) return Megaphone;
  if (type.startsWith("report.")) return FileCheck2;
  if (type.includes("quote")) return FileSignature;
  if (type.includes("invoice") || type.includes("slip") || type.includes("payment")) return Receipt;
  return Bell;
}

const colomboDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" });

/** Today, Yesterday, Earlier. Without a clock (server, hydration) everything stays in one list. */
function groupByDay<T extends { createdAt: string }>(items: T[], now: number | null): { label: string | null; items: T[] }[] {
  if (now === null) return [{ label: null, items }];
  const today = colomboDay.format(now);
  const yesterday = colomboDay.format(now - 86_400_000);
  const label = (n: T) => {
    const day = colomboDay.format(new Date(n.createdAt));
    return day === today ? "Today" : day === yesterday ? "Yesterday" : "Earlier";
  };
  return ["Today", "Yesterday", "Earlier"].flatMap((l) => {
    const here = items.filter((n) => label(n) === l);
    return here.length ? [{ label: l, items: here }] : [];
  });
}

/** Header bell: the latest notifications, unread count, and mark-as-read. Live via Realtime. */
export function NotificationBell({ userId, items, unread }: { userId: string; items: NotificationItem[]; unread: number }) {
  const [, start] = useTransition();
  const now = useNow();
  const [state, apply] = useOptimistic({ items, unread }, (s, change: { ids?: string[] }) => ({
    items: s.items.map((n) => (!change.ids || change.ids.includes(n.id) ? { ...n, read: true } : n)),
    unread: change.ids ? Math.max(0, s.unread - s.items.filter((n) => change.ids!.includes(n.id) && !n.read).length) : 0,
  }));

  const markRead = (ids?: string[]) =>
    start(async () => {
      apply({ ids });
      await markNotificationsRead(ids);
    });

  return (
    <>
      <RealtimeRefresh sources={[{ table: "notifications", filter: `user_id=eq.${userId}` }]} />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground hover:text-foreground" aria-label={state.unread ? `Notifications, ${state.unread} unread` : "Notifications"}>
            {state.unread ? <BellRing /> : <Bell />}
            {state.unread ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-orange px-1 text-[10px] font-semibold text-white tabular-nums ring-2 ring-background">
                {state.unread > 9 ? "9+" : state.unread}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {state.unread ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => markRead()}>
                <CheckCheck /> Mark all read
              </Button>
            ) : null}
          </div>
          {state.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Bell className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">Assignments, returns and other updates appear here.</p>
            </div>
          ) : (
            <div className="max-h-[min(28rem,70svh)] overflow-y-auto">
              {groupByDay(state.items, now).map((group) => (
                <section key={group.label ?? "all"} aria-label={group.label ?? "Notifications"}>
                  {group.label ? <h3 className="sticky top-0 z-[1] bg-popover/95 px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase backdrop-blur">{group.label}</h3> : null}
                  <ul className="divide-y">
                    {group.items.map((n) => {
                      const Icon = iconFor(n.type);
                      const body = (
                        <div className="flex gap-3 px-4 py-3">
                          <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", n.urgent && !n.read ? "bg-brand-orange/10 text-brand-orange-ink" : "bg-muted text-muted-foreground")}>
                            <Icon className="size-3.5" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-sm", !n.read && "font-medium")}>
                              {!n.read ? <span className="sr-only">Unread: </span> : null}
                              {n.title}
                            </p>
                            {n.body ? <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p> : null}
                            <RelativeTime iso={n.createdAt} className="mt-1 block text-[11px] text-muted-foreground" />
                          </div>
                          {!n.read ? <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" /> : null}
                        </div>
                      );
                      return (
                        <li key={n.id} className={cn(!n.read && "bg-primary/[0.03]")}>
                          {n.link ? (
                            <Link href={n.link} className="block outline-none hover:bg-muted/50 focus-visible:bg-muted/50" onClick={() => !n.read && markRead([n.id])}>
                              {body}
                            </Link>
                          ) : (
                            <button type="button" className="block w-full text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50" onClick={() => !n.read && markRead([n.id])}>
                              {body}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
