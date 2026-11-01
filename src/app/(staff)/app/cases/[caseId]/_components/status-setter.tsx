"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setCaseStatus } from "../../actions";

const AUTOMATIC = "__automatic__";

/** Ontriq's own statuses from Settings, Workflow. One lasts until the case moves stage. */
export function StatusSetter({ caseId, value, options }: { caseId: string; value: string | null; options: { key: string; label: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <Select
      value={value ?? AUTOMATIC}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          const r = await setCaseStatus(caseId, v === AUTOMATIC ? null : v);
          if (r.ok) toast.success(v === AUTOMATIC ? "Status back to automatic" : "Status set");
          else toast.error(r.error);
        })
      }
    >
      <SelectTrigger size="sm" className="h-7 w-44 text-xs" aria-label="Set a status on this case">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTOMATIC}>Automatic status</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
