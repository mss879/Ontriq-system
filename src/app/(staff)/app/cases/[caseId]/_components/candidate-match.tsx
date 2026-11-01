"use client";

import { useTransition } from "react";
import { UserRoundSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { resolveCandidateMatch } from "../../actions";

/**
 * A portal request's NIC matches a candidate on file under another name. It may
 * be the same person, or a typing slip that points at somebody else, so a person
 * decides before the request is accepted and anyone is contacted.
 */
export function CandidateMatch({ caseId, typed, onFile, canDecide }: { caseId: string; typed: string; onFile: string; canDecide: boolean }) {
  const [pending, start] = useTransition();
  const decide = (same: boolean) =>
    start(async () => {
      const r = await resolveCandidateMatch(caseId, same);
      if (r.ok) toast.success(same ? "Linked to the candidate on file" : "Kept as a separate candidate");
      else toast.error(r.error);
    });
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <UserRoundSearch className="size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
      <div className="min-w-0 flex-[1_1_16rem]">
        <p className="font-medium">This NIC is already on file under another name</p>
        <p className="text-muted-foreground">
          The client wrote {typed}. The record says {onFile}. Check which is right before you accept the request.
        </p>
      </div>
      {canDecide ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => decide(true)}>
            {pending ? <Spinner /> : null} Same person
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
            Different person
          </Button>
        </div>
      ) : null}
    </div>
  );
}
