/**
 * Quotations, invoices, receipts, credit notes and statements as PDFs in
 * Ontriq's three designs (Executive, Modern, Classic), drawn from the shared
 * DocumentModel (src/domain/documents/model.ts). The HTML twin used for live
 * previews is src/components/documents/document-preview.tsx; keep the two in
 * step. Plain Node: relative imports only.
 */
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { C, LogoLockup, LogoMark, registerFonts } from "./pdf-kit";
import { formatAmount } from "../../domain/pricing/money";
import type { DocumentModel, TemplateKey } from "../../domain/documents/model";

type Theme = {
  headerBg: string;
  headerInk: string;
  titleFont: "SourceSerif" | "StackSans" | "Inter";
  accent: string;
  tableHeadBg: string;
  tableHeadInk: string;
  borders: boolean;
  dense: boolean;
};

const THEMES: Record<TemplateKey, Theme> = {
  executive: { headerBg: C.navyDeep, headerInk: C.white, titleFont: "SourceSerif", accent: C.orange, tableHeadBg: C.navyDeep, tableHeadInk: C.white, borders: false, dense: false },
  modern: { headerBg: C.white, headerInk: C.ink, titleFont: "StackSans", accent: C.navy, tableHeadBg: C.soft, tableHeadInk: C.muted, borders: false, dense: false },
  classic: { headerBg: C.white, headerInk: C.ink, titleFont: "SourceSerif", accent: C.ink, tableHeadBg: "#EEF1F5", tableHeadInk: C.ink, borders: true, dense: true },
};

function Header({ m, t }: { m: DocumentModel; t: Theme }) {
  const dark = t.headerBg !== C.white;
  return (
    <View>
      <View style={{ backgroundColor: t.headerBg, paddingHorizontal: 44, paddingTop: dark ? 30 : 34, paddingBottom: dark ? 24 : 14, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <LogoLockup height={dark ? 30 : 28} ink={dark ? C.white : C.ink} />
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontFamily: t.titleFont, fontWeight: 700, fontSize: 20, color: t.headerInk }}>{m.title}</Text>
          <Text style={{ fontSize: 9.5, marginTop: 3, color: dark ? "#C9D6E8" : C.muted }}>{m.number}</Text>
          {m.badge ? (
            <Text style={{ marginTop: 5, fontSize: 7.5, fontWeight: 700, letterSpacing: 1.2, color: m.badge === "PAID" || m.badge === "ACCEPTED" ? C.green : C.red, borderWidth: 1, borderColor: m.badge === "PAID" || m.badge === "ACCEPTED" ? C.green : C.red, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>
              {m.badge}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ height: dark ? 4 : 1.5, backgroundColor: t.accent, marginHorizontal: dark ? 0 : 44 }} />
    </View>
  );
}

function Parties({ m, t }: { m: DocumentModel; t: Theme }) {
  return (
    <View style={{ flexDirection: "row", gap: 24, marginTop: 20 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 7.5, letterSpacing: 1.2, fontWeight: 600, color: C.muted }}>{m.kind === "receipt" ? "RECEIVED FROM" : m.kind === "statement" ? "STATEMENT FOR" : "TO"}</Text>
        <Text style={{ fontSize: 11, fontWeight: 600, color: C.ink, marginTop: 4 }}>{m.to.name}</Text>
        {m.to.lines.map((l, i) => (
          <Text key={i} style={{ fontSize: 9, color: C.body }}>{l}</Text>
        ))}
      </View>
      <View style={{ width: 210, borderWidth: t.borders ? 0.75 : 0, borderColor: C.line, backgroundColor: t.borders ? C.white : C.soft, borderRadius: t.borders ? 0 : 6, padding: 10 }}>
        {m.meta.map((x) => (
          <View key={x.label} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
            <Text style={{ fontSize: 8.5, color: C.muted }}>{x.label}</Text>
            <Text style={{ fontSize: 8.5, color: C.ink, fontWeight: 600 }}>{x.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Lines({ m, t }: { m: DocumentModel; t: Theme }) {
  if (!m.lines.length) return null;
  const pad = t.dense ? 4 : 6;
  const cols = m.showDiscount ? ["52%", "8%", "14%", "10%", "16%"] : ["60%", "8%", "16%", "0%", "16%"];
  const cell = (w: string, align: "left" | "right" = "left") => ({ width: w, padding: pad, textAlign: align, fontSize: 8.8 } as const);
  const border = t.borders ? { borderWidth: 0.75, borderColor: C.line } : {};
  return (
    <View style={{ marginTop: 18, ...border }}>
      <View style={{ flexDirection: "row", backgroundColor: t.tableHeadBg }}>
        <Text style={{ ...cell(cols[0]), color: t.tableHeadInk, fontWeight: 600, fontSize: 7.5 }}>DESCRIPTION</Text>
        <Text style={{ ...cell(cols[1], "right"), color: t.tableHeadInk, fontWeight: 600, fontSize: 7.5 }}>QTY</Text>
        <Text style={{ ...cell(cols[2], "right"), color: t.tableHeadInk, fontWeight: 600, fontSize: 7.5 }}>UNIT ({m.currency})</Text>
        {m.showDiscount ? <Text style={{ ...cell(cols[3], "right"), color: t.tableHeadInk, fontWeight: 600, fontSize: 7.5 }}>DISC.</Text> : null}
        <Text style={{ ...cell(cols[4], "right"), color: t.tableHeadInk, fontWeight: 600, fontSize: 7.5 }}>AMOUNT</Text>
      </View>
      {m.lines.map((l, i) => (
        <View key={i} wrap={false} style={{ flexDirection: "row", borderTopWidth: 0.75, borderTopColor: C.line, backgroundColor: !t.borders && i % 2 ? "#FAFBFC" : C.white }}>
          <Text style={{ ...cell(cols[0]), color: C.ink }}>{l.description}</Text>
          <Text style={cell(cols[1], "right")}>{l.quantity}</Text>
          <Text style={cell(cols[2], "right")}>{formatAmount(l.unit_price)}</Text>
          {m.showDiscount ? <Text style={cell(cols[3], "right")}>{l.discount_pct ? `${l.discount_pct}%` : ""}</Text> : null}
          <Text style={{ ...cell(cols[4], "right"), color: C.ink }}>{formatAmount(l.total)}</Text>
        </View>
      ))}
    </View>
  );
}

function Statement({ m, t }: { m: DocumentModel; t: Theme }) {
  if (!m.statement) return null;
  const widths = ["14%", "14%", "27%", "15%", "15%", "15%"];
  const head = ["DATE", "TYPE", "REFERENCE", "DEBIT", "CREDIT", "BALANCE"];
  return (
    <View style={{ marginTop: 18, borderWidth: t.borders ? 0.75 : 0, borderColor: C.line }}>
      <View style={{ flexDirection: "row", backgroundColor: t.tableHeadBg }}>
        {head.map((h, i) => (
          <Text key={h} style={{ width: widths[i], padding: 5, fontSize: 7.5, fontWeight: 600, color: t.tableHeadInk, textAlign: i >= 3 ? "right" : "left" }}>{h}</Text>
        ))}
      </View>
      {m.statement.rows.map((r, i) => (
        <View key={i} wrap={false} style={{ flexDirection: "row", borderTopWidth: 0.75, borderTopColor: C.line }}>
          {[r.date, r.kind, r.reference, r.debit, r.credit, r.balance].map((v, j) => (
            <Text key={j} style={{ width: widths[j], padding: 5, fontSize: 8.5, textAlign: j >= 3 ? "right" : "left", color: j === 5 ? C.ink : C.body }}>{v}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Totals({ m, t }: { m: DocumentModel; t: Theme }) {
  if (!m.totals.length) return null;
  const card = !t.borders;
  return (
    <View wrap={false} style={{ marginTop: 12, alignSelf: "flex-end", width: 250, padding: card ? 12 : 0, backgroundColor: card ? C.soft : C.white, borderRadius: card ? 6 : 0, borderWidth: t.borders ? 0.75 : 0, borderColor: C.line }}>
      {m.totals.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: row.strong ? 5 : 2.5, paddingHorizontal: t.borders ? 8 : 0, borderTopWidth: row.strong ? 0.75 : 0, borderTopColor: C.line }}>
          <Text style={{ fontSize: row.strong ? 10 : 9, fontWeight: row.strong ? 700 : 400, color: row.strong ? C.ink : C.body }}>{row.label}</Text>
          <Text style={{ fontSize: row.strong ? 10.5 : 9, fontWeight: row.strong ? 700 : 500, color: C.ink }}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Prose({ m, t }: { m: DocumentModel; t: Theme }) {
  return (
    <>
      {m.subtitle ? <Text style={{ fontFamily: t.titleFont, fontWeight: 700, fontSize: 14, color: C.ink, marginTop: 22 }}>{m.subtitle}</Text> : null}
      {m.intro ? <Text style={{ fontSize: 9.5, marginTop: m.subtitle ? 6 : 18, lineHeight: 1.5 }}>{m.intro}</Text> : null}
      {m.sections.map((sct) => (
        <View key={sct.heading} style={{ marginTop: 12 }} wrap={false}>
          <Text style={{ fontSize: 8, letterSpacing: 1.1, fontWeight: 700, color: t.accent === C.ink ? C.ink : C.navy }}>{sct.heading.toUpperCase()}</Text>
          <Text style={{ fontSize: 9.2, marginTop: 3, lineHeight: 1.5 }}>{sct.body}</Text>
        </View>
      ))}
    </>
  );
}

function Tiers({ m, t }: { m: DocumentModel; t: Theme }) {
  if (!m.tiers.length) return null;
  return (
    <View style={{ marginTop: 14 }} wrap={false}>
      <Text style={{ fontSize: 8, letterSpacing: 1.1, fontWeight: 700, color: t.accent === C.ink ? C.ink : C.navy }}>VOLUME DISCOUNTS</Text>
      {m.tiers.map((tier, i) => (
        <Text key={i} style={{ fontSize: 9, marginTop: 3 }}>
          {tier.range}: {tier.discount}
          {tier.note ? ` (${tier.note})` : ""}
        </Text>
      ))}
    </View>
  );
}

export function DocumentPdf({ model: m, template }: { model: DocumentModel; template: TemplateKey }) {
  const t = THEMES[template] ?? THEMES.executive;
  return (
    <Document title={`${m.title} ${m.number}`} author={m.issuer.legal_name}>
      <Page size="A4" style={{ fontFamily: "Inter", color: C.body, paddingBottom: 60 }} wrap>
        <Header m={m} t={t} />
        <View style={{ paddingHorizontal: 44 }}>
          <Parties m={m} t={t} />
          <Prose m={m} t={t} />
          <Lines m={m} t={t} />
          <Statement m={m} t={t} />
          <Totals m={m} t={t} />
          <Tiers m={m} t={t} />
          {m.note ? (
            <View style={{ marginTop: 16, padding: 10, borderLeftWidth: 3, borderLeftColor: t.accent, backgroundColor: C.soft }} wrap={false}>
              <Text style={{ fontSize: 9 }}>{m.note}</Text>
            </View>
          ) : null}
          {m.payment.length ? (
            <View style={{ marginTop: 16 }} wrap={false}>
              <Text style={{ fontSize: 8, letterSpacing: 1.1, fontWeight: 700, color: C.ink }}>HOW TO PAY</Text>
              {m.payment.map((p, i) => (
                <Text key={i} style={{ fontSize: 8.8, marginTop: 2 }}>{p}</Text>
              ))}
            </View>
          ) : null}
          {m.closing ? <Text style={{ fontSize: 9.5, marginTop: 16, lineHeight: 1.5 }}>{m.closing}</Text> : null}
          {m.acceptance ? (
            <View style={{ marginTop: 16, padding: 10, borderWidth: 0.75, borderColor: C.green, borderRadius: 4 }} wrap={false}>
              <Text style={{ fontSize: 9, color: C.green, fontWeight: 600 }}>{m.acceptance}</Text>
            </View>
          ) : null}
        </View>
        <View fixed style={{ position: "absolute", bottom: 22, left: 44, right: 44, borderTopWidth: 0.75, borderTopColor: C.line, paddingTop: 7, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "85%" }}>
            <LogoMark size={8} />
            <Text style={{ fontSize: 7, color: C.muted }}>{m.footer}</Text>
          </View>
          <Text style={{ fontSize: 7, color: C.muted }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderDocumentPdf(model: DocumentModel, template: TemplateKey): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<DocumentPdf model={model} template={template} />);
}
