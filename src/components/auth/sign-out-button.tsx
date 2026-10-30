"use client";

import { useTransition } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { hardNavigate } from "@/lib/client/hard-navigate";

/** Signs out, then hard-navigates so no preserved screen state survives. */
export function SignOutButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signOut();
          hardNavigate("/login");
        })
      }
      {...props}
    >
      {children ?? "Sign out"}
    </Button>
  );
}
