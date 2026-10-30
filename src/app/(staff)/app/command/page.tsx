import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Skeleton } from "@/components/ui/skeleton";
import { createRequestClient } from "@/lib/supabase/server";
import { getStaffViewer } from "@/lib/server/viewer";
import { commandUsageToday, latestBriefing, listMemories, listThreads, threadDetail } from "@/lib/ai/assistant/queries";
import { sttConfigured } from "@/lib/stt/provider";
import { CommandWorkspace } from "./command-workspace";

export const metadata: Metadata = { title: "Command" };

/**
 * The Super Admin's command assistant (plan §9): the whole system by text or
 * voice, answers as messages with tables and cards, and confirm cards for
 * every change. Everyone else is sent back to the dashboard.
 */
export default function CommandPage({ searchParams }: PageProps<"/app/command">) {
  return (
    <Suspense fallback={<CommandSkeleton />}>
      <Command searchParams={searchParams} />
    </Suspense>
  );
}

async function Command({ searchParams }: { searchParams: PageProps<"/app/command">["searchParams"] }) {
  await getStaffViewer();
  const supabase = await createRequestClient();
  const { data: allowed } = await supabase.rpc("can_use_assistant", { p_kind: "command" });
  if (!allowed) redirect("/app");
  const { t } = await searchParams;
  const wanted = typeof t === "string" && z.uuid().safeParse(t).success ? t : null;
  const [threads, detail, memories, usage, briefing, { data: budget }] = await Promise.all([
    listThreads(supabase, "command"),
    wanted ? threadDetail(supabase, wanted) : Promise.resolve(null),
    listMemories(supabase),
    commandUsageToday(supabase),
    latestBriefing(supabase),
    supabase.from("ai_budgets").select("daily_usd").eq("capability", "assistant.command").maybeSingle(),
  ]);
  const initial = detail && detail.thread.kind === "command" ? detail : null;
  return (
    <CommandWorkspace
      initialThreads={threads}
      initial={initial}
      memories={memories}
      usage={{ ...usage, dailyCapUsd: budget?.daily_usd === null || budget?.daily_usd === undefined ? null : Number(budget.daily_usd) }}
      briefing={briefing}
      canRecord={sttConfigured()}
    />
  );
}

function CommandSkeleton() {
  return (
    <div className="flex h-[calc(100svh-3.5rem)] md:h-[calc(100svh-4.5rem)]" aria-hidden>
      <div className="hidden w-72 shrink-0 space-y-3 border-r p-4 lg:block">
        <Skeleton className="h-9 w-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex-1" />
        <div className="border-t p-3">
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
