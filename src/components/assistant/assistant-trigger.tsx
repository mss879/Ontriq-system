"use client";

import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const ASSISTANT_OPEN_EVENT = "ontriq:assistant-open";

/** Opens Ask Ontriq from the top bar, so it never sits on top of the page's content. */
export function AssistantTrigger() {
  const pathname = usePathname();
  // The Command page is the same assistant at full size.
  if (pathname.startsWith("/app/command")) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Ask Ontriq (Command J)" className="size-7 px-0 lg:h-8 lg:w-auto lg:px-2.5" onClick={() => window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT))}>
          <Sparkles className="text-brand-orange" />
          <span className="hidden lg:inline">Ask Ontriq</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        Ask Ontriq <Kbd className="bg-background/15 text-background">⌘J</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
