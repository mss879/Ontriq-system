"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-[60svh] flex-col items-center justify-center gap-5 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-orange/10 text-brand-orange-ink ring-1 ring-brand-orange/20">
        <TriangleAlert className="size-5" />
      </span>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          The problem has been noted. Try again, and if it keeps happening tell your administrator
          {error.digest ? (
            <>
              {" "}
              (reference <span className="font-mono text-xs">{error.digest}</span>)
            </>
          ) : null}
          .
        </p>
      </div>
      <Button onClick={() => retry()} size="lg" className="h-10 px-5">
        <RotateCw /> Try again
      </Button>
    </main>
  );
}
