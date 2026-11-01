import { describe, expect, it } from "vitest";
import { CANDIDATE_DICTS, categoryLabel, checkLabel, documentGuide, fmt, timelineTitle, translateUploadMessage } from "@/domain/candidate/i18n";
import { BUILTIN_CHECK_TYPES, DOCUMENT_CATEGORIES } from "@/domain/check-types/builtin";
import { checkFile } from "@/lib/client/upload";
import { errorText } from "@/components/candidate/errors";

/** Every leaf "section.key" with its {placeholders}. */
function leaves(obj: Record<string, unknown>, prefix = ""): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    // English reads the check type's own words, so these two are only filled in for si and ta.
    if (path === "fields" || path === "options") continue;
    if (typeof v === "string") out.set(path, [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    else for (const [p, vars] of leaves(v as Record<string, unknown>, path)) out.set(p, vars);
  }
  return out;
}

describe("candidate page translations", () => {
  it("keeps a further record's own name in every language", () => {
    expect(checkLabel(CANDIDATE_DICTS.en, "education", "Education: Secondary")).toBe(`${CANDIDATE_DICTS.en.checks.education}: Secondary`);
    expect(checkLabel(CANDIDATE_DICTS.si, "education", "Education")).toBe(CANDIDATE_DICTS.si.checks.education);
    expect(checkLabel(CANDIDATE_DICTS.en, null, "Custom check")).toBe("Custom check");
  });

  const en = leaves(CANDIDATE_DICTS.en);

  it.each(["si", "ta"] as const)("%s has every English string with the same placeholders", (lang) => {
    const other = leaves(CANDIDATE_DICTS[lang]);
    expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, vars] of en) expect(other.get(key), key).toEqual(vars);
  });

  it.each(["si", "ta"] as const)("%s names every field a candidate fills in", (lang) => {
    const dict = CANDIDATE_DICTS[lang];
    const asked = BUILTIN_CHECK_TYPES.flatMap((t) => t.schema.fields ?? []).flatMap((f) => [f, ...((f as { fields?: typeof f[] }).fields ?? [])]);
    for (const f of asked) {
      if (!f.fill_by?.includes("candidate")) continue;
      expect(dict.fields[f.key], f.key).toBeTruthy();
      for (const o of f.options ?? []) if (f.key !== "qualification_level") expect(dict.options[o.value], o.value).toBeTruthy();
    }
  });

  it("names every built-in document category in all three languages", () => {
    for (const lang of ["en", "si", "ta"] as const) {
      for (const c of DOCUMENT_CATEGORIES) expect(categoryLabel(CANDIDATE_DICTS[lang], c.key, null), `${lang} ${c.key}`).not.toBe(c.key);
    }
    expect(categoryLabel(CANDIDATE_DICTS.si, "custom_kind", "Custom kind")).toBe("Custom kind");
  });

  it("speaks to the candidate in their language for built-in document help, and keeps what Ontriq typed", () => {
    const staffOnly = new Set(["field_verification", "verification_response", "sanction_report"]);
    const fromCategories = DOCUMENT_CATEGORIES.filter((c) => !staffOnly.has(c.key)).map((c) => c.guide);
    const fromChecks = BUILTIN_CHECK_TYPES.flatMap((t) => t.schema.documents ?? [])
      .filter((d) => d.client_visible && d.description)
      .map((d) => d.description as string);
    const caseSlots = ["The candidate's latest CV.", "The candidate's completed BGV form with their signed consent."];
    for (const text of [...fromCategories, ...fromChecks, ...caseSlots]) {
      for (const lang of ["si", "ta"] as const) expect(documentGuide(CANDIDATE_DICTS[lang], text), `${lang}: ${text}`).not.toBe(text);
      expect(documentGuide(CANDIDATE_DICTS.en, text), text).not.toContain("The candidate");
    }
    expect(documentGuide(CANDIDATE_DICTS.si, "Please bring the signed original.")).toBe("Please bring the signed original.");
    expect(documentGuide(CANDIDATE_DICTS.si, null)).toBeNull();
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

describe("what the database refuses, in the candidate's language", () => {
  it.each(["en", "si", "ta"] as const)("%s", (lang) => {
    const t = CANDIDATE_DICTS[lang];
    expect(errorText(t, "this verification is closed")).toBe(t.expired.closed);
    expect(errorText(t, "your consent has already been accepted")).toBe(t.errors.consentAccepted);
    expect(errorText(t, "your verification no longer takes uploads")).toBe(t.documents.closed);
    // The session action capitalises what the database says.
    expect(errorText(t, "This answer has already been accepted.")).toBe(t.errors.answerAccepted);
    expect(errorText(t, "This verification is closed.")).toBe(t.expired.closed);
    expect(errorText(t, "Too many uploads at once; wait a moment and try again.")).toBe(t.errors.tooMany);
  });
});
