import { describe, expect, it } from "vitest";
import { CANDIDATE_DICTS, categoryLabel, fmt, timelineTitle, translateUploadMessage } from "@/domain/candidate/i18n";
import { DOCUMENT_CATEGORIES } from "@/domain/check-types/builtin";
import { checkFile } from "@/lib/client/upload";

/** Every leaf "section.key" with its {placeholders}. */
function leaves(obj: Record<string, unknown>, prefix = ""): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(path, [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    else for (const [p, vars] of leaves(v as Record<string, unknown>, path)) out.set(p, vars);
  }
  return out;
}

describe("candidate page translations", () => {
  const en = leaves(CANDIDATE_DICTS.en);

  it.each(["si", "ta"] as const)("%s has every English string with the same placeholders", (lang) => {
    const other = leaves(CANDIDATE_DICTS[lang]);
    expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, vars] of en) expect(other.get(key), key).toEqual(vars);
  });

  it("names every built-in document category in all three languages", () => {
    for (const lang of ["en", "si", "ta"] as const) {
      for (const c of DOCUMENT_CATEGORIES) expect(categoryLabel(CANDIDATE_DICTS[lang], c.key, null), `${lang} ${c.key}`).not.toBe(c.key);
    }
    expect(categoryLabel(CANDIDATE_DICTS.si, "custom_kind", "Custom kind")).toBe("Custom kind");
  });

  it("fills placeholders and localises timeline entries", () => {
    expect(fmt("Hello {name}, {n}%", { name: "Ama", n: 40 })).toBe("Hello Ama, 40%");
    expect(fmt("Keep {unknown}")).toBe("Keep {unknown}");
    const t = CANDIDATE_DICTS.ta;
    expect(timelineTitle(t, { kind: "document_uploaded", title: "NIC copy received from the candidate", data: { to: null, category: "nic_copy" } })).toBe(
      "தேசிய அடையாள அட்டையின் நகல் பெறப்பட்டது",
    );
    expect(timelineTitle(t, { kind: "stage_changed", title: "x", data: { to: "verification", category: null } })).toBe(t.timeline.stage_verification);
    expect(timelineTitle(t, { kind: "something_new", title: "Kept in English", data: { to: null, category: null } })).toBe("Kept in English");
  });

  it("translates the upload helper's English messages", () => {
    const big = { name: "x.pdf", type: "application/pdf", size: 30 * 1024 * 1024 } as File;
    expect(translateUploadMessage(CANDIDATE_DICTS.si, checkFile(big)!)).toBe(CANDIDATE_DICTS.si.errors.fileSize);
    const exe = { name: "x.exe", type: "application/x-msdownload", size: 5000 } as File;
    expect(translateUploadMessage(CANDIDATE_DICTS.ta, checkFile(exe)!)).toBe(CANDIDATE_DICTS.ta.errors.fileType);
  });
});
