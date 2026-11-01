/**
 * The sheet in front of each annexure, and the title page of a further part.
 * Drawn with react-pdf so long titles wrap and Sinhala or Tamil names print.
 * Plain Node: relative imports only.
 */
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { BODY_FONTS, C, DISPLAY_FONTS, registerFonts } from "../documents/pdf-kit";

export type CoverModel = {
  reference: string;
  /** "Annexure 3", or "Appendix A 3". */
  heading: string;
  title: string;
  filename: string;
  /** Plain lines about how the file is attached. */
  lines: string[];
  /** Warnings, printed in red. */
  warnings: string[];
  sha256: string | null;
  /** What a combined file holds. */
  contents?: string[];
  draft: boolean;
};

const page = { fontFamily: BODY_FONTS, fontSize: 10, color: C.body, paddingTop: 54, paddingHorizontal: 48, lineHeight: 1.4 };

function Band() {
  return <View fixed style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: C.orange }} />;
}

function Watermark() {
  return (
    <View fixed style={{ position: "absolute", top: 330, left: 70, transform: "rotate(-30deg)" }}>
      <Text style={{ fontFamily: DISPLAY_FONTS, fontSize: 110, fontWeight: 700, color: C.red, opacity: 0.08, letterSpacing: 8 }}>DRAFT</Text>
    </View>
  );
}

function CoverPage({ m }: { m: CoverModel }) {
  return (
    <Document title={m.heading} author="Ontriq">
      <Page size="A4" style={page}>
        <Band />
        {m.draft ? <Watermark /> : null}
        <Text style={{ fontSize: 9, color: C.muted }}>
          {m.reference} · {m.heading}
        </Text>
        <Text style={{ marginTop: 14, fontFamily: DISPLAY_FONTS, fontSize: 18, fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>{m.title}</Text>
        <Text style={{ marginTop: 6, color: C.body }}>{m.filename}</Text>
        {m.lines.map((line) => (
          <Text key={line} style={{ marginTop: 8, color: C.body }}>
            {line}
          </Text>
        ))}
        {m.sha256 ? <Text style={{ marginTop: 8, fontSize: 7.5, color: C.muted }}>File fingerprint (SHA-256): {m.sha256}</Text> : null}
        {m.warnings.map((line) => (
          <Text key={line} style={{ marginTop: 10, fontWeight: 700, color: C.red }}>
            {line}
          </Text>
        ))}
        {m.contents?.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: 700, color: C.ink, marginBottom: 4 }}>This file holds</Text>
            {m.contents.map((line) => (
              <Text key={line} style={{ marginBottom: 2 }}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

export async function renderAnnexureCover(m: CoverModel): Promise<Uint8Array> {
  registerFonts();
  return new Uint8Array(await renderToBuffer(<CoverPage m={m} />));
}

export async function renderPartTitle(input: { reference: string; part: number; draft: boolean; verifyUrl?: string | null }): Promise<Uint8Array> {
  registerFonts();
  return new Uint8Array(
    await renderToBuffer(
      <Document title={`${input.reference} annexures, part ${input.part}`} author="Ontriq">
        <Page size="A4" style={page}>
          <Band />
          {input.draft ? <Watermark /> : null}
          <Text style={{ fontSize: 9, color: C.muted }}>{input.reference}</Text>
          <Text style={{ marginTop: 14, fontFamily: DISPLAY_FONTS, fontSize: 20, fontWeight: 700, color: C.ink }}>Annexures, part {input.part}</Text>
          <Text style={{ marginTop: 8 }}>Supporting evidence that follows on from the verification report.</Text>
          {input.verifyUrl ? <Text style={{ marginTop: 8, fontSize: 8.5, color: C.muted }}>To check this file is genuine, open {input.verifyUrl} and compare its fingerprint.</Text> : null}
        </Page>
      </Document>,
    ),
  );
}
