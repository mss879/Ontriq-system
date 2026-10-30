"use client";

import { catchError, type ErrorInfo } from "next/error";
import { RotateCw, TriangleAlert } from "lucide-react";
import { SURFACE } from "@/components/admin/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function SectionError({ label }: { label?: string }, { retry }: ErrorInfo) {
  return (
    <div role="alert" className={cn(SURFACE, "flex flex-wrap items-center gap-3 px-5 py-4")}>
      <TriangleAlert className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{label ? `Couldn't load ${label}.` : "Couldn't load this section."}</p>
      <Button variant="outline" size="sm" onClick={() => retry()}>
        <RotateCw /> Try again
      </Button>
    </div>
  );
}

/** Keeps a failure inside one section: the rest of the page and the sidebar stay usable. */
export const SectionBoundary = catchError(SectionError);
