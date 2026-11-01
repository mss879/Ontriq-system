"use client";

import Link from "@/components/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** A page that fails stays inside the frame, so navigation keeps working. */
export default function AreaError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Empty className="flex-1 py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-brand-orange/10 text-brand-orange-ink">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>This page didn&apos;t load</EmptyTitle>
        <EmptyDescription>
          Try again, and if it keeps happening tell your administrator
          {error.digest ? (
            <>
              {" "}
              (reference <span className="font-mono text-xs">{error.digest}</span>)
            </>
          ) : null}
          .
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button onClick={() => retry()}>
          <RotateCw /> Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/app">Back to dashboard</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
