import Link from "@/components/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** A record that doesn't exist, or isn't yours to see. Stays inside the frame. */
export default function AreaNotFound() {
  return (
    <Empty className="flex-1 py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-muted text-muted-foreground">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>We couldn&apos;t find that</EmptyTitle>
        <EmptyDescription>It may have moved, or you may not have access to it.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link href="/app">Back to dashboard</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
