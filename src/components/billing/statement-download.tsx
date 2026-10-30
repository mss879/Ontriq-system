"use client";

import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Pick a period and open the statement as a PDF or CSV (/api/statements/<client>). */
export function StatementDownload({ clientId, compact = false }: { clientId: string; compact?: boolean }) {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))));
  const [to, setTo] = useState(iso(today));
  const href = (format?: "csv") => `/api/statements/${clientId}?from=${from}&to=${to}${format ? "&format=csv" : ""}`;
  const bad = !from || !to || from > to;
  return (
    <div className="space-y-2.5">
      <div className={compact ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2 sm:flex-row"}>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" disabled={bad}>
          <a href={bad ? undefined : href()} target="_blank" rel="noreferrer">
            <Download /> Statement PDF
          </a>
        </Button>
        <Button asChild variant="ghost" size="sm" disabled={bad}>
          <a href={bad ? undefined : href("csv")}>
            <FileSpreadsheet /> CSV
          </a>
        </Button>
      </div>
    </div>
  );
}
