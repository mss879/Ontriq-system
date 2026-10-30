import { describe, expect, it } from "vitest";
import { createSseParser } from "@/components/assistant/sse";
import { parseInline, parseMarkdown, safeHref } from "@/components/assistant/markdown";
import { columnKind, dateOf, numberOf, sortRows } from "@/components/assistant/sort";
import type { AssistantEvent } from "@/lib/ai/assistant/types";

describe("assistant SSE parser", () => {
  it("reads frames split across chunks and skips bad ones", () => {
    const got: AssistantEvent[] = [];
    const p = createSseParser((e) => got.push(e));
    p.push('event: thread\ndata: {"type":"thread","id":"t1","title":"Hi"}\n\nevent: text\nda');
    p.push('ta: {"type":"text","delta":"Hel"}\n\n');
    p.push("event: text\ndata: not json\n\n");
    p.push('event: text\r\ndata: {"type":"text","delta":"lo"}\r\n\r\n');
    p.push('event: done\ndata: {"type":"done","message_id":null}');
    p.end();
    expect(got.map((e) => e.type)).toEqual(["thread", "text", "text", "done"]);
    expect(got.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("Hello");
  });

  it("ignores frames without a type", () => {
    const got: AssistantEvent[] = [];
    const p = createSseParser((e) => got.push(e));
    p.push('data: {"hello":1}\n\n: comment\n\n');
    expect(got).toHaveLength(0);
  });
});

describe("assistant markdown", () => {
  it("parses paragraphs, lists, bold and code", () => {
    const md = parseMarkdown("You have **3** overdue checks.\n\n- ONT-1 `due`\n- ONT-2\n\n1. First\n2. Second\nAfter");
    expect(md.map((b) => b.type)).toEqual(["p", "ul", "ol", "p"]);
    expect(md[0]).toEqual({ type: "p", inline: [{ type: "text", text: "You have " }, { type: "bold", text: "3" }, { type: "text", text: " overdue checks." }] });
    expect((md[1] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("keeps only same-app links", () => {
    expect(parseInline("[Open](/app/cases/abc) and [bad](https://evil.example) and [js](javascript:alert(1))")).toEqual([
      { type: "link", text: "Open", href: "/app/cases/abc" },
      { type: "text", text: " and " },
      { type: "text", text: "bad" },
      { type: "text", text: " and " },
      { type: "text", text: "js" },
      { type: "text", text: ")" },
    ]);
    expect(safeHref("//evil.example/app")).toBeNull();
    expect(safeHref("/app/invoices?status=overdue")).toBe("/app/invoices?status=overdue");
    expect(safeHref("/apps")).toBeNull();
  });

  it("never produces HTML", () => {
    const md = parseMarkdown("<script>alert(1)</script>");
    expect(md).toEqual([{ type: "p", inline: [{ type: "text", text: "<script>alert(1)</script>" }] }]);
  });

  it("drops headings to text", () => {
    expect(parseMarkdown("## Summary")).toEqual([{ type: "p", inline: [{ type: "text", text: "Summary" }] }]);
  });
});

describe("assistant table sorting", () => {
  it("reads amounts, percentages and dates", () => {
    expect(numberOf("LKR 12,500.00")).toBe(12500);
    expect(numberOf("83%")).toBe(83);
    expect(numberOf("Overdue")).toBeNull();
    expect(dateOf("12 Oct", 2026)).toBe(Date.UTC(2026, 9, 12));
    expect(dateOf("2026-03-01")).toBe(Date.UTC(2026, 2, 1));
  });

  it("sorts by kind with empty cells last", () => {
    const rows = [
      ["INV-3", "LKR 1,000.00", "12 Oct"],
      ["INV-1", "—", "1 Mar"],
      ["INV-2", "LKR 250.50", "—"],
      ["INV-10", "LKR 9,999.00", "5 Jan"],
    ];
    expect(columnKind(rows, 1)).toBe("number");
    expect(columnKind(rows, 2)).toBe("date");
    expect(sortRows(rows, 1, "asc").map((r) => r[0])).toEqual(["INV-2", "INV-3", "INV-10", "INV-1"]);
    expect(sortRows(rows, 1, "desc").map((r) => r[0])).toEqual(["INV-10", "INV-3", "INV-2", "INV-1"]);
    expect(sortRows(rows, 2, "asc").map((r) => r[0])).toEqual(["INV-10", "INV-1", "INV-3", "INV-2"]);
    expect(sortRows(rows, 0, "asc").map((r) => r[0])).toEqual(["INV-1", "INV-2", "INV-3", "INV-10"]);
  });
});
