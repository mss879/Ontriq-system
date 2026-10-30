"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Development only: email isn't configured, so the one-time setup link is shown to copy by hand. */
export function InviteLinkNotice({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-xs text-muted-foreground">Email isn&apos;t configured, so here is the setup link (development only):</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            window.prompt("Copy the setup link", url);
          }
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy setup link"}
      </Button>
    </div>
  );
}
