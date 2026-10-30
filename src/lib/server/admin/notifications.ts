import "server-only";
import { createRequestClient } from "@/lib/supabase/server";

export type NotificationItem = { id: string; type: string; title: string; body: string; link: string | null; urgent: boolean; read: boolean; createdAt: string };

/** The signed-in person's latest notifications and how many are unread (RLS: own rows only). */
export async function latestNotifications(limit = 20): Promise<{ items: NotificationItem[]; unread: number }> {
  const supabase = await createRequestClient();
  const [{ data }, { count }] = await Promise.all([
    supabase.from("notifications").select("id, type, title, body, link, urgent, read_at, created_at").order("created_at", { ascending: false }).limit(limit),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return {
    items: (data ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      urgent: n.urgent,
      read: Boolean(n.read_at),
      createdAt: n.created_at,
    })),
    unread: count ?? 0,
  };
}
