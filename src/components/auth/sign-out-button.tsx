"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOutNow } from "@/lib/client/sign-out";

/** Signs out with a full page load, so no preserved screen state survives. */
export function SignOutButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        signOutNow();
      }}
      {...props}
    >
      {children ?? "Sign out"}
    </Button>
  );
}
