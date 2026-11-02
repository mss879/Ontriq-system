import { describe, expect, it } from "vitest";
import { ttlMemo } from "@/lib/server/ttl-memo";

describe("ttlMemo", () => {
  it("returns a value until its lifetime ends", () => {
    const memo = ttlMemo<string>(1000, 10);
    memo.set("a", "first", 0);
    expect(memo.get("a", 999)).toBe("first");
    expect(memo.get("a", 1000)).toBeUndefined();
  });

  it("forgets a deleted value", () => {
    const memo = ttlMemo<string>(1000, 10);
    memo.set("a", "first", 0);
    memo.delete("a");
    expect(memo.get("a", 1)).toBeUndefined();
  });

  it("drops the oldest entry when full", () => {
    const memo = ttlMemo<number>(1000, 2);
    memo.set("a", 1, 0);
    memo.set("b", 2, 0);
    memo.set("c", 3, 0);
    expect(memo.get("a", 1)).toBeUndefined();
    expect(memo.get("b", 1)).toBe(2);
    expect(memo.get("c", 1)).toBe(3);
  });

  it("replaces a value without dropping another", () => {
    const memo = ttlMemo<number>(1000, 2);
    memo.set("a", 1, 0);
    memo.set("b", 2, 0);
    memo.set("b", 3, 0);
    expect(memo.get("a", 1)).toBe(1);
    expect(memo.get("b", 1)).toBe(3);
  });
});
