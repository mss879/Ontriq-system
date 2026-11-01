"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ExtraCheck = { checkTypeId: string; label: string };

/**
 * A second record of a check on the request (spec 4.1: "Primary / Secondary").
 * Each one is its own check, with its own details, evidence and result.
 */
export function ExtraChecksField({ types, value, onChange }: { types: { id: string; name: string }[]; value: ExtraCheck[]; onChange: (next: ExtraCheck[]) => void }) {
  const offered = types.filter((t) => /education|employment/i.test(t.name));
  const available = offered.length ? offered : types;
  if (!available.length) return null;
  const nameOf = (id: string) => types.find((t) => t.id === id)?.name ?? "Check";
  const setAt = (i: number, change: Partial<ExtraCheck>) => onChange(value.map((row, j) => (j === i ? { ...row, ...change } : row)));
  // Only checks still on the request count.
  const rows = value.filter((row) => types.some((t) => t.id === row.checkTypeId));

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">More than one record?</h3>
        <p className="text-[13px] text-muted-foreground">Add another check for a second qualification, such as secondary school and a degree. Each gets its own details and result.</p>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
          <Select
            value={row.checkTypeId}
            onValueChange={(id) => {
              const old = `${nameOf(row.checkTypeId)}: `;
              setAt(i, { checkTypeId: id, label: row.label.startsWith(old) ? `${nameOf(id)}: ${row.label.slice(old.length)}` : row.label });
            }}
          >
            <SelectTrigger className="w-full" aria-label="Kind of check">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input aria-label="Name of this check" maxLength={120} value={row.label} onChange={(e) => setAt(i, { label: e.target.value })} placeholder="e.g. Education: Secondary" />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${row.label || "this check"}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { checkTypeId: available[0].id, label: `${available[0].name}: Secondary` }])}>
        <Plus /> Add a record
      </Button>
    </div>
  );
}
