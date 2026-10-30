import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, canAny } from "@/domain/permissions";

describe("permission catalog", () => {
  it("matches the catalog seeded by 0001_foundation.sql", () => {
    const sql = readFileSync("supabase/migrations/0001_foundation.sql", "utf8");
    const block = sql.slice(sql.indexOf("insert into public.permissions"), sql.indexOf("on conflict (key) do update"));
    const sqlRows = [...block.matchAll(/\('([^']+)',\s*'([a-z]+)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*'(staff|client)',\s*(true|false)/g)].map(
      ([, key, group, kind, grantable]) => ({ key, group, kind, grantable: grantable === "true" }),
    );
    const tsRows = PERMISSIONS.map(({ key, group, kind, grantable }) => ({ key, group, kind, grantable }));
    expect(sqlRows.length).toBeGreaterThan(40);
    expect(new Set(sqlRows.map((r) => JSON.stringify(r)))).toEqual(new Set(tsRows.map((r) => JSON.stringify(r))));
  });

  it("honours the wildcard", () => {
    expect(can({ permissions: ["*"] }, "reports.release")).toBe(true);
    expect(can({ permissions: ["cases.read"] }, "reports.release")).toBe(false);
    expect(can(null, "cases.read")).toBe(false);
    expect(canAny({ permissions: ["qc.pre"] }, ["qc.post", "qc.pre"])).toBe(true);
  });

  it("keeps the command assistant out of reach of custom roles", () => {
    expect(PERMISSIONS.find((p) => p.key === "ai.super_assistant")?.grantable).toBe(false);
  });
});
