/**
 * The verification report body (react-pdf), drawn from a ReportSnapshot:
 * cover with the final result and verification QR, summary, one section per
 * check, evidence list, QC and approval details and the result legend.
 * Drafts carry a DRAFT watermark on every page. Annexures are appended by
 * assemble.ts. Plain Node: relative imports only.
 */
import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import QRCode from "qrcode";
import { C, LogoLockup, LogoMark, registerFonts, s } from "../documents/pdf-kit";
import { RESULT_WORDS, type ReportSnapshot } from "../../domain/reports/compile-core";
import type { ResultTone } from "../../domain/check-types/schema";

const TONE: Record<ResultTone, string> = { green: C.green, amber: C.amber, red: C.red };

export type ReportRenderOptions = {
  kind: "draft" | "final";
  version: number;
  finalResult: ResultTone | null;
  approvedBy: string | null;
  approvedOn: string | null;
  verifyUrl: string | null;
  generatedOn: string;
  revisionReason: string | null;
};

function Chip({ tone, label }: { tone: ResultTone | null; label: string }) {
  const color = tone ? TONE[tone] : C.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingVertical: 2, paddingHorizontal: 7, backgroundColor: `${color}1A` }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 7.5, fontWeight: 600, color }}>{label}</Text>
    </View>
  );
}

function Watermark() {
  return (
    <View fixed style={{ position: "absolute", top: 330, left: 70, transform: "rotate(-30deg)" }}>
      <Text style={{ fontFamily: "StackSans", fontSize: 110, fontWeight: 700, color: C.red, opacity: 0.08, letterSpacing: 8 }}>DRAFT</Text>
    </View>
  );
}

function Frame({ snapshot, opts, children }: { snapshot: ReportSnapshot; opts: ReportRenderOptions; children: ReactNode }) {
  return (
    <Page size="A4" style={s.page} wrap>
      {opts.kind === "draft" ? <Watermark /> : null}
      <View style={s.header} fixed>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <LogoMark size={10} />
          <Text style={s.headerText}>BACKGROUND VERIFICATION REPORT</Text>
        </View>
        <Text style={s.headerText}>
          {snapshot.case.reference}
          {opts.kind === "draft" ? ` · DRAFT v${opts.version}` : ` · v${opts.version}`}
        </Text>
      </View>
      {children}
      <View style={s.footer} fixed>
        <Text>{snapshot.org.legal_name} · Strictly confidential · Prepared for {snapshot.case.client}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}

function KV({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <View style={{ borderWidth: 0.75, borderColor: C.line, borderRadius: 4 }}>
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={{ flexDirection: "row", borderTopWidth: i ? 0.75 : 0, borderTopColor: C.line }} wrap={false}>
          <Text style={{ width: "36%", padding: 6, backgroundColor: C.soft, fontSize: 8.5, color: C.muted }}>{r.label}</Text>
          <Text style={{ width: "64%", padding: 6, fontSize: 9, color: C.ink }}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function GroupTable({ label, columns, rows }: { label: string; columns: string[]; rows: string[][] }) {
  const w = `${100 / Math.max(columns.length, 1)}%`;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 8.5, fontWeight: 600, color: C.ink, marginBottom: 4 }}>{label}</Text>
      <View style={{ borderWidth: 0.75, borderColor: C.line, borderRadius: 4 }}>
        <View style={{ flexDirection: "row", backgroundColor: C.soft }}>
          {columns.map((c) => (
            <Text key={c} style={{ width: w, padding: 5, fontSize: 7.5, fontWeight: 600, color: C.muted }}>{c}</Text>
          ))}
        </View>
        {rows.map((row, i) => (
          <View key={i} style={{ flexDirection: "row", borderTopWidth: 0.75, borderTopColor: C.line }} wrap={false}>
            {row.map((cell, j) => (
              <Text key={j} style={{ width: w, padding: 5, fontSize: 8.5, color: C.ink }}>{cell}</Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Cover({ snapshot, opts, qr }: { snapshot: ReportSnapshot; opts: ReportRenderOptions; qr: string | null }) {
  const tone = opts.kind === "final" ? opts.finalResult : snapshot.proposed_result;
  const word = tone ? RESULT_WORDS[tone] : null;
  return (
    <Page size="A4" style={{ fontFamily: "Inter", color: C.body, backgroundColor: C.white }}>
      {opts.kind === "draft" ? <Watermark /> : null}
      <View style={{ backgroundColor: C.navyDeep, paddingHorizontal: 48, paddingTop: 44, paddingBottom: 36 }}>
        <LogoLockup height={34} ink={C.white} />
        <Text style={{ marginTop: 42, fontSize: 8, letterSpacing: 2, color: "#9FB6D3", fontWeight: 600 }}>BACKGROUND VERIFICATION REPORT</Text>
        <Text style={{ marginTop: 8, fontFamily: "StackSans", fontSize: 28, fontWeight: 700, color: C.white, lineHeight: 1.15 }}>{snapshot.candidate.full_name}</Text>
        <Text style={{ marginTop: 6, fontSize: 10.5, color: "#C9D6E8" }}>
          {[snapshot.case.position, snapshot.case.client].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <View style={{ height: 4, backgroundColor: C.orange }} />
      <View style={{ paddingHorizontal: 48, paddingTop: 30 }}>
        <View style={{ flexDirection: "row", gap: 24 }}>
          <View style={{ flex: 1 }}>
            <KV
              rows={[
                { label: "Reference", value: snapshot.case.reference },
                ...(snapshot.case.client_reference ? [{ label: "Client reference", value: snapshot.case.client_reference }] : []),
                { label: "Requested by", value: snapshot.case.client },
                ...(snapshot.case.package ? [{ label: "Package", value: snapshot.case.package }] : []),
                ...(snapshot.candidate.nic ? [{ label: "NIC", value: snapshot.candidate.nic }] : []),
                { label: "Received", value: snapshot.case.received_on },
                ...(snapshot.case.completed_on ? [{ label: "Verification completed", value: snapshot.case.completed_on }] : []),
                { label: "Report", value: `${opts.kind === "draft" ? "Draft" : "Final"} version ${opts.version} · ${opts.generatedOn}` },
              ]}
            />
          </View>
          <View style={{ width: 170, borderRadius: 8, borderWidth: 0.75, borderColor: C.line, padding: 14, alignItems: "center" }}>
            <Text style={{ fontSize: 7.5, letterSpacing: 1.4, fontWeight: 600, color: C.muted }}>{opts.kind === "final" ? "FINAL RESULT" : "PROPOSED RESULT"}</Text>
            {word && tone ? (
              <>
                <View style={{ marginTop: 10, width: 54, height: 54, borderRadius: 27, backgroundColor: TONE[tone], alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: C.white, fontWeight: 700, fontSize: 10 }}>{word.label.toUpperCase()}</Text>
                </View>
                <Text style={{ marginTop: 10, fontSize: 8, textAlign: "center", color: C.body }}>{word.meaning}</Text>
              </>
            ) : (
              <Text style={{ marginTop: 14, fontSize: 9, color: C.muted }}>Not decided</Text>
            )}
          </View>
        </View>
        {opts.revisionReason ? (
          <View style={{ marginTop: 16, padding: 10, borderLeftWidth: 3, borderLeftColor: C.amber, backgroundColor: C.soft }}>
            <Text style={{ fontSize: 8.5, color: C.ink }}>Revised report. {opts.revisionReason}</Text>
          </View>
        ) : null}
        {qr && opts.verifyUrl ? (
          <View style={{ marginTop: 26, flexDirection: "row", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={qr} style={{ width: 74, height: 74 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9, fontWeight: 600, color: C.ink }}>Check this report is genuine</Text>
              <Text style={{ fontSize: 8, color: C.muted, marginTop: 3 }}>Scan the code or open {opts.verifyUrl} and compare the fingerprint shown there with this file.</Text>
            </View>
          </View>
        ) : null}
        <Text style={{ marginTop: 26, fontSize: 7.5, color: C.muted, lineHeight: 1.5 }}>
          This report is confidential and was prepared for {snapshot.case.client} only. It reflects information confirmed with the sources named in each section up to the
          completion date. Do not share it beyond those who need it for the hiring decision.
        </Text>
      </View>
    </Page>
  );
}

export function ReportDocument({ snapshot, opts, qr }: { snapshot: ReportSnapshot; opts: ReportRenderOptions; qr: string | null }) {
  return (
    <Document title={`${snapshot.case.reference} verification report`} author={snapshot.org.legal_name} subject="Background verification report">
      <Cover snapshot={snapshot} opts={opts} qr={qr} />
      <Frame snapshot={snapshot} opts={opts}>
        <Text style={s.eyebrow}>Summary</Text>
        <Text style={s.h1}>What we checked</Text>
        <View style={{ borderWidth: 0.75, borderColor: C.line, borderRadius: 4, marginBottom: 14 }}>
          <View style={{ flexDirection: "row", backgroundColor: C.soft }}>
            <Text style={{ width: "46%", padding: 6, fontSize: 7.5, fontWeight: 600, color: C.muted }}>CHECK</Text>
            <Text style={{ width: "27%", padding: 6, fontSize: 7.5, fontWeight: 600, color: C.muted }}>STATUS</Text>
            <Text style={{ width: "27%", padding: 6, fontSize: 7.5, fontWeight: 600, color: C.muted }}>RESULT</Text>
          </View>
          {snapshot.summary.map((row, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 0.75, borderTopColor: C.line }} wrap={false}>
              <Text style={{ width: "46%", padding: 6, fontSize: 9, color: C.ink }}>{row.label}</Text>
              <Text style={{ width: "27%", padding: 6, fontSize: 8.5 }}>{row.status_label}</Text>
              <View style={{ width: "27%", padding: 6 }}>
                {row.result_label ? <Chip tone={row.result_tone} label={row.result_label} /> : <Text style={{ fontSize: 8.5, color: C.muted }}>—</Text>}
              </View>
            </View>
          ))}
        </View>

        {snapshot.checks.map((check, i) => (
          <View key={check.key + i} style={{ marginTop: 10 }} break={i > 0 && check.groups.length > 0}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }} wrap={false}>
              <Text style={s.h2}>{check.label}</Text>
              {check.result_label ? <Chip tone={check.result_tone} label={check.result_label} /> : <Chip tone={null} label={check.status_label} />}
            </View>
            {check.fields.length ? <KV rows={check.fields} /> : null}
            {check.groups.map((g) => (
              <GroupTable key={g.label} label={g.label} columns={g.columns} rows={g.rows} />
            ))}
            {check.status === "incomplete" ? (
              <Text style={{ ...s.small, marginTop: 4 }}>This check was not completed and is not reported as verified.</Text>
            ) : null}
            {check.remarks ? (
              <View style={{ marginTop: 6 }}>
                <Text style={{ fontSize: 8, fontWeight: 600, color: C.ink }}>Remarks</Text>
                <Text style={{ fontSize: 9, marginTop: 2 }}>{check.remarks}</Text>
              </View>
            ) : null}
            {check.evidence.length ? <Text style={{ ...s.small, marginTop: 4 }}>Evidence: {check.evidence.join("; ")}</Text> : null}
            {check.completed_on ? <Text style={{ ...s.small, marginTop: 2 }}>Completed {check.completed_on}</Text> : null}
          </View>
        ))}

        {snapshot.annexures.length ? (
          <View style={{ marginTop: 16 }} wrap={false}>
            <Text style={s.h2}>Annexures</Text>
            {snapshot.annexures.map((a, i) => (
              <Text key={a.document_id} style={{ fontSize: 8.5, marginBottom: 2 }}>
                Annexure {i + 1}: {a.title} ({a.filename}){a.kind === "fixed" ? " · attached unchanged" : ""}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={{ marginTop: 16 }} wrap={false}>
          <Text style={s.h2}>Quality control and approval</Text>
          <KV
            rows={[
              ...snapshot.qc.map((q) => ({ label: q.kind === "pre" ? "Pre-QC" : "Post-QC", value: `${q.reviewer} · ${q.on}` })),
              ...(opts.kind === "final" && opts.approvedBy ? [{ label: "Approved", value: `${opts.approvedBy}${opts.approvedOn ? ` · ${opts.approvedOn}` : ""}` }] : []),
              ...(opts.kind === "draft" ? [{ label: "Approval", value: "Awaiting final approval" }] : []),
            ]}
          />
        </View>

        <View style={{ marginTop: 16 }} wrap={false}>
          <Text style={s.h2}>Result key</Text>
          {(["green", "amber", "red"] as const).map((t) => (
            <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <Chip tone={t} label={RESULT_WORDS[t].label} />
              <Text style={{ fontSize: 8.5 }}>{RESULT_WORDS[t].meaning}</Text>
            </View>
          ))}
          <Text style={{ ...s.small, marginTop: 6 }}>
            A potential finding is never treated as adverse on its own; read each section. Checks that were not completed are marked as such and are not reported as verified.
          </Text>
        </View>
      </Frame>
    </Document>
  );
}

export async function renderReportBody(snapshot: ReportSnapshot, opts: ReportRenderOptions): Promise<Buffer> {
  registerFonts();
  const qr = opts.verifyUrl ? await QRCode.toDataURL(opts.verifyUrl, { margin: 0, width: 300, errorCorrectionLevel: "M" }) : null;
  return renderToBuffer(<ReportDocument snapshot={snapshot} opts={opts} qr={qr} />);
}
