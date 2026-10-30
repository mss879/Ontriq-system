"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { Bell, BellRing, CheckCheck } from "lucide-react";
import { markNotificationsRead } from "@/app/(staff)/app/notification-actions";
import type { NotificationItem } from "@/lib/server/admin/notifications";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Header bell: the latest notifications, unread count, and mark-as-read. Live via Realtime. */
export function NotificationBell({ userId, items, unread }: { userId: string; items: NotificationItem[]; unread: number }) {
  const [, start] = useTransition();
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
            <ul className="max-h-[min(28rem,70svh)] divide-y overflow-y-auto">
              {state.items.map((n) => {
                const body = (
                  <div className="flex gap-3 px-4 py-3">
                    <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : n.urgent ? "bg-brand-orange" : "bg-primary")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", !n.read && "font-medium")}>{n.title}</p>
                      {n.body ? <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p> : null}
                      <RelativeTime iso={n.createdAt} className="mt-1 block text-[11px] text-muted-foreground" />
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className={cn(!n.read && "bg-primary/[0.03]")}>
                    {n.link ? (
                      <Link href={n.link} className="block hover:bg-muted/50" onClick={() => !n.read && markRead([n.id])}>
                        {body}
                      </Link>
                    ) : (
                      <button type="button" className="block w-full text-left hover:bg-muted/50" onClick={() => !n.read && markRead([n.id])}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
