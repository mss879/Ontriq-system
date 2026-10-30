"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setStaffMfaRequired } from "./actions";
import { Switch } from "@/components/ui/switch";

export function MfaPolicySwitch({ required, canEdit }: { required: boolean; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={required}
      disabled={!canEdit || pending}
      aria-label="Require two-step verification for staff"
      onCheckedChange={(value) =>
        start(async () => {
          const result = await setStaffMfaRequired(value);
          if (result.ok) toast.success(value ? "Two-step verification is now required" : "Two-step verification is now optional");
          else toast.error(result.error);
        })
      }
    />
  );
}
