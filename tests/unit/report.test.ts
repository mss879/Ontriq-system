import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { canonicalJson, compileReport, fixedAnnexureCategories, formatFieldValue, type ReportAnnexure, type ReportInputs } from "@/domain/reports/compile-core";
import { assembleReport, assembleReportPart, MAX_ANNEXURE_BYTES, MAX_ANNEXURE_PAGES, planAnnexures, type AnnexureFile } from "../../src/jobs/report/assemble";
import { jpegOrientation } from "../../src/jobs/report/convert-image";
import { BUILTIN_CHECK_TYPES } from "@/domain/check-types/builtin";
import { parseCheckTypeSchema } from "@/domain/check-types/schema";

const schemaOf = (key: string) => parseCheckTypeSchema(BUILTIN_CHECK_TYPES.find((t) => t.key === key)!.schema);

const inputs = (): ReportInputs => ({
  org: { name: "Ontriq", legal_name: "Ontriq (Pvt) Ltd", address: "Dehiwala", phone: "+94 77", email: "info@ontriq.com", website: "https://www.ontriq.com" },
  case: { reference: "ONT-2026-000001", client_name: "Hemas", client_reference: "EMP-1", position_title: "Accountant", department: null, package_name: "Standard", process_type: "client_supplied", received_at: "2026-11-01T04:00:00Z", completed_at: "2026-11-08T10:00:00Z", proposed_result: "green" },
  candidate: { full_name: "Nimal Perera", nic: "853400937V", date_of_birth: "1985-12-05" },
  checks: [
    { id: "c2", key: "employment", label: "Employment", sort: 20, state: "in_progress", result: null, result_tone: null, client_note: null, values: {}, completed_at: null, schema: schemaOf("employment") },
    { id: "c1", key: "nic", label: "NIC verification", sort: 10, state: "completed", result: "clear", result_tone: "green", client_note: "Matches DRP records.", values: { nic_number: "853400937V", date_of_birth: "1985-12-05" }, completed_at: "2026-11-02T06:00:00Z", schema: schemaOf("nic") },
  ],
  documents: [
    { id: "d2", case_check_id: null, category: "sanction_report", category_name: "Global sanction screening report", filename: "cfirst.pdf", mime: "application/pdf", sha256: "x", created_at: "2026-11-03T00:00:00Z" },
    { id: "d1", case_check_id: "c1", category: "nic_copy", category_name: "NIC copy", filename: "nic.jpg", mime: "image/jpeg", sha256: null, created_at: "2026-11-01T00:00:00Z" },
  ],
  qc: [
    { kind: "pre", reviewer: "Qasim", created_at: "2026-11-02T00:00:00Z" },
    { kind: "pre", reviewer: "Older", created_at: "2026-11-01T00:00:00Z" },
  ],
});

describe("report compile", () => {
  it("orders checks, and never shows an incomplete check as verified", () => {
    const r = compileReport(inputs());
    expect(r.summary.map((s) => s.label)).toEqual(["NIC verification", "Employment"]);
    expect(r.summary[0]).toMatchObject({ status: "verified", result_label: "Clear", result_tone: "green" });
    expect(r.summary[1]).toMatchObject({ status: "incomplete", status_label: "Pending", result_label: null, result_tone: null });
    expect(r.checks[1].fields).toEqual([]);
    expect(r.checks[0].remarks).toBe("Matches DRP records.");
    expect(r.checks[0].evidence).toEqual(["NIC copy: nic.jpg"]);
    expect(r.qc).toEqual([{ kind: "pre", reviewer: "Qasim", on: "2 Nov 2026" }]);
  });

  it("puts the fixed annexure after the evidence, untouched", () => {
    const r = compileReport(inputs());
    expect(r.annexures.map((a) => [a.kind, a.filename])).toEqual([["evidence", "nic.jpg"], ["evidence", "cfirst.pdf"]]);
    // Sanction screening is a fixed annexure only when the case has that check; here it's ordinary evidence.
    const withSanction = inputs();
    withSanction.checks.push({ id: "c3", key: "sanction", label: "Global sanction screening", sort: 30, state: "completed", result: "clear", result_tone: "green", client_note: null, values: {}, completed_at: null, schema: schemaOf("sanction") });
    const r2 = compileReport(withSanction);
    expect(r2.annexures.map((a) => [a.kind, a.filename])).toEqual([["evidence", "nic.jpg"], ["fixed", "cfirst.pdf"]]);
  });

  it("hashes the same content the same way whatever the input order", () => {
    const a = inputs();
    const b = inputs();
    b.checks.reverse();
    b.documents.reverse();
    expect(canonicalJson(compileReport(a))).toBe(canonicalJson(compileReport(b)));
    b.checks[0].client_note = "changed";
    expect(canonicalJson(compileReport(a))).not.toBe(canonicalJson(compileReport(b)));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("formats field values for print", () => {
    expect(formatFieldValue({ key: "p", label: "Period", type: "date_range" } as never, { from: "2020-01-01", present: true })).toBe("01/01/20 to present");
    expect(formatFieldValue({ key: "p", label: "Period", type: "date_range" } as never, { from: "2020-01-01", to: "" })).toBe("From 01/01/20");
    expect(formatFieldValue({ key: "x", label: "X", type: "boolean" } as never, false)).toBe("No");
    expect(formatFieldValue({ key: "s", label: "S", type: "select", options: [{ value: "a", label: "Alpha" }] } as never, "a")).toBe("Alpha");
  });
});

describe("reports with pending checks", () => {
  it("don't claim verification finished", () => {
    const input = inputs();
    for (const k of input.checks) k.state = "completed";
    expect(compileReport(input).case.completed_on).not.toBeNull();
    input.checks[0].state = "in_progress";
    const r = compileReport(input);
    expect(r.case.completed_on).toBeNull();
    expect(r.summary.find((s) => s.label === input.checks[0].label)?.status_label).toBe("Pending");
  });
});

describe("the fixed annexure", () => {
  const pdf = async (pages: number) => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) doc.addPage();
    return doc.save();
  };
  const annexure = (kind: ReportAnnexure["kind"], filename: string, bytes: Uint8Array | null): AnnexureFile => ({
    document_id: filename,
    title: kind === "fixed" ? "Global sanction screening report" : "Evidence",
    filename,
    mime: "application/pdf",
    kind,
    check_label: null,
    sha256: null,
    read: async () => bytes,
  });
  const opts = { reference: "ONT-2026-000001", draft: true };

  it("goes in on any case that still has the check", () => {
    const sanction = { state: "completed", schema: schemaOf("sanction") };
    expect(fixedAnnexureCategories([sanction, { state: "completed", schema: schemaOf("nic") }])).toEqual(["sanction_report"]);
    expect(fixedAnnexureCategories([{ ...sanction, state: "waived" }])).toEqual([]);
  });

  it("is embedded even when the evidence used up the page limit", async () => {
    const plan = await planAnnexures([annexure("evidence", "bulky.pdf", await pdf(MAX_ANNEXURE_PAGES + 1)), annexure("evidence", "late.pdf", await pdf(1)), annexure("fixed", "cfirst.pdf", await pdf(3))], { parts: true });
    expect(plan.map((a) => [a.filename, a.status, a.part])).toEqual([
      ["bulky.pdf", "embedded", 1],
      ["late.pdf", "embedded", 2],
      ["cfirst.pdf", "embedded", 1],
    ]);
  });

  it("is reported when the file can't be embedded, so the report can stop", async () => {
    const plan = await planAnnexures([annexure("fixed", "cfirst.pdf", new TextEncoder().encode("not a pdf")), annexure("fixed", "gone.pdf", null)], { parts: true });
    expect(plan.map((a) => a.status)).toEqual(["damaged", "unreadable"]);
  });

  /** The files held inside a PDF, by name. */
  const attachments = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    const files = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict)?.lookupMaybe(PDFName.of("Names"), PDFArray);
    return files ? files.size() / 2 : 0;
  };

  it("travels inside the report as the file itself, as well as its pages", async () => {
    const plan = await planAnnexures([annexure("fixed", "cfirst.pdf", await pdf(3))], { parts: true });
    const r = await assembleReport(await pdf(1), plan, opts);
    expect(plan[0].status).toBe("embedded");
    expect(await attachments(r.bytes)).toBe(1);
    expect(r.pages).toBe(1 + 1 + 3);
  });

  it("is kept as the file itself when it is protected, instead of stopping the report", async () => {
    const plain = new TextDecoder("latin1").decode(await (await PDFDocument.create({})).save({ useObjectStreams: false }));
    const locked = Uint8Array.from(plain.replace("trailer\n<<", "trailer\n<<\n/Encrypt 1 0 R"), (c) => c.charCodeAt(0));
    const plan = await planAnnexures([annexure("fixed", "cfirst.pdf", locked)], { parts: true });
    expect(plan[0].status).toBe("attached");
    const r = await assembleReport(await pdf(1), plan, opts);
    expect(await attachments(r.bytes)).toBe(1);
  });

  it("says when a file no longer matches what was uploaded", async () => {
    const plan = await planAnnexures([{ ...annexure("evidence", "letter.pdf", await pdf(1)), sha256: "not-its-fingerprint" }], { parts: true });
    expect(plan[0].altered).toBe(true);
  });

  it("keeps two bad files apart when they share a name", async () => {
    const good = await pdf(1);
    const [first, second] = await planAnnexures(
      [{ ...annexure("evidence", "image.pdf", good), document_id: "a" }, { ...annexure("evidence", "image.pdf", new TextEncoder().encode("broken")), document_id: "b" }],
      { parts: true },
    );
    expect([first.status, second.status]).toEqual(["embedded", "damaged"]);
  });

  it("doesn't count a PDF with nothing in it", async () => {
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    const [a] = await planAnnexures([annexure("evidence", "blank.pdf", empty)], { parts: true });
    expect(a.status).toBe("damaged");
  });

  it("leaves one cover sheet when a file can't be embedded", async () => {
    const plan = await planAnnexures([annexure("evidence", "broken.pdf", new TextEncoder().encode("not a pdf"))], { parts: true });
    const r = await assembleReport(await pdf(1), plan, opts);
    expect(r.pages).toBe(1 + 1);
  });

  it("marks copied pages on a draft, and leaves a final's alone", async () => {
    const file = await pdf(1);
    const plan = await planAnnexures([annexure("evidence", "letter.pdf", file)], { parts: true });
    const draft = await assembleReport(await pdf(1), plan, { ...opts, draft: true });
    const final = await assembleReport(await pdf(1), plan, { ...opts, draft: false });
    expect(draft.bytes.byteLength).toBeGreaterThan(final.bytes.byteLength);
  });
});

describe("a report too big for one file", () => {
  const pdf = async (pages: number) => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) doc.addPage();
    return doc.save();
  };
  const evidence = (filename: string, bytes: Uint8Array): AnnexureFile => ({ document_id: filename, title: "Evidence", filename, mime: "application/pdf", kind: "evidence", check_label: null, sha256: null, read: async () => bytes });
  const opts = { reference: "ONT-2026-000001", draft: false };

  it("carries on in the next part, leaving nothing out", async () => {
    const plan = await planAnnexures([evidence("first.pdf", await pdf(MAX_ANNEXURE_PAGES - 1)), evidence("second.pdf", await pdf(5)), evidence("third.pdf", await pdf(2))], { parts: true });
    expect(plan.map((a) => a.part)).toEqual([1, 2, 2]);
    const next = await assembleReportPart(plan, { ...opts, part: 2 });
    // Its title page, then a cover and the pages for each file.
    expect(next.pages).toBe(1 + (1 + 5) + (1 + 2));
  });

  it("keeps each annexure's number across parts", async () => {
    const plan = await planAnnexures([evidence("first.pdf", await pdf(MAX_ANNEXURE_PAGES)), evidence("second.pdf", await pdf(1))], { parts: true });
    expect(plan[1]).toMatchObject({ filename: "second.pdf", number: 2, part: 2 });
  });

  it("takes a very long file whole, on a part of its own", async () => {
    const plan = await planAnnexures([evidence("long.pdf", await pdf(MAX_ANNEXURE_PAGES + 2))], { parts: true });
    expect(plan[0].part).toBe(1);
    const r = await assembleReport(await pdf(1), plan, { ...opts, part: 1 });
    expect(r.pages).toBe(1 + 1 + MAX_ANNEXURE_PAGES + 2);
  });

  it("splits on size well below what Storage takes", async () => {
    expect(MAX_ANNEXURE_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
    // Six 18 MB scans: too big for one file, so they spread over parts instead of failing the upload.
    const big = (name: string): AnnexureFile => ({ document_id: name, title: "Scan", filename: name, mime: "image/heic", kind: "evidence", check_label: null, sha256: null, read: async () => null });
    const plan = await planAnnexures([big("a"), big("b")], { parts: true });
    expect(plan.every((a) => a.status === "unreadable")).toBe(true);
  });

  it("says what was left out when a report has no further parts", async () => {
    const plan = await planAnnexures([evidence("first.pdf", await pdf(MAX_ANNEXURE_PAGES)), evidence("second.pdf", await pdf(1))], { parts: false });
    expect(plan.map((a) => a.status)).toEqual(["embedded", "left_out"]);
  });
});

describe("annexure pages", () => {
  // Pages with something on them, as real evidence has.
  const letter = async (pages: number) => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) doc.addPage().drawText(`Page ${i + 1}`, { x: 50, y: 700 });
    return doc.save();
  };
  // A 1×1 PNG.
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const file = (filename: string, mime: string, bytes: Uint8Array, sha256: string | null = null): AnnexureFile => ({ document_id: filename, title: "Evidence", filename, mime, kind: "evidence", check_label: null, sha256, read: async () => bytes });
  const opts = { reference: "ONT-2026-000001", draft: false };
  const body = async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    return doc.save();
  };

  it("start on their heading's page, with no sheet in front", async () => {
    const plan = await planAnnexures([file("letter.pdf", "application/pdf", await letter(3)), file("reply.png", "image/png", png)], { parts: true });
    const r = await assembleReport(await body(), plan, opts);
    // The body, then three pages of the letter and one of the screenshot.
    expect(r.pages).toBe(1 + 3 + 1);
  });

  it("put both sides of an NIC on one page", async () => {
    const nic = (filename: string, mime: string, bytes: Uint8Array) => ({ ...file(filename, mime, bytes), category: "nic_copy" });
    const sides = await planAnnexures([nic("nic.pdf", "application/pdf", await letter(2)), file("letter.pdf", "application/pdf", await letter(2))], { parts: true });
    // The NIC's two pages share one; any other file keeps a page each.
    expect((await assembleReport(await body(), sides, opts)).pages).toBe(1 + 1 + 2);
    const photos = await planAnnexures([nic("front.png", "image/png", png), nic("back.png", "image/png", png)], { parts: true });
    expect((await assembleReport(await body(), photos, opts)).pages).toBe(1 + 1);
  });

  it("keep a cover sheet when there is something to explain", async () => {
    const plan = await planAnnexures([file("letter.pdf", "application/pdf", await letter(2), "not-its-fingerprint")], { parts: true });
    const r = await assembleReport(await body(), plan, opts);
    expect(r.pages).toBe(1 + 1 + 2);
  });
});

describe("phone photos", () => {
  const exif = (orientation: number) => {
    // A JPEG start, an Exif header, a little-endian TIFF block holding one tag.
    const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const size = 2 + 6 + tiff.length;
    return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 255, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff, 0xff, 0xda]);
  };
  it("reads which way up the camera says they are", () => {
    expect(jpegOrientation(exif(6))).toBe(6);
    expect(jpegOrientation(exif(3))).toBe(3);
    expect(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda]))).toBe(1);
    expect(jpegOrientation(Uint8Array.from([0x00, 0x01]))).toBe(1);
  });
});

describe("field values in the report", () => {
  it("prints a year as a year", () => {
    const year = schemaOf("education").fields.find((f) => f.key === "year_of_completion")!;
    expect(formatFieldValue(year, 2015)).toBe("2015");
  });
});
