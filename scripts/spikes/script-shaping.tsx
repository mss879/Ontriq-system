/**
 * Spike: does react-pdf shape Sinhala and Tamil correctly with Noto fonts?
 *   npx tsx scripts/spikes/script-shaping.tsx <out.pdf>
 * Compare the output with the same strings rendered by a browser.
 */
import { Document, Page, Text, View, renderToFile } from "@react-pdf/renderer";
import { registerFonts } from "../../src/jobs/documents/pdf-kit";

const SAMPLES = [
  { label: "Sinhala: Sri Lanka (conjunct with ZWJ)", text: "ශ්‍රී ලංකාව", font: "NotoSinhala" },
  { label: "Sinhala: Colombo (two-part vowel sign)", text: "කොළඹ", font: "NotoSinhala" },
  { label: "Sinhala: name", text: "නිමල් පෙරේරා", font: "NotoSinhala" },
  { label: "Sinhala: address", text: "අංක 10, ගාලු පාර, කොළඹ 03", font: "NotoSinhala" },
  { label: "Tamil: Sri Lanka", text: "இலங்கை", font: "NotoTamil" },
  { label: "Tamil: Colombo (split vowel sign)", text: "கொழும்பு", font: "NotoTamil" },
  { label: "Tamil: name", text: "நிமல் பெரேரா", font: "NotoTamil" },
  { label: "Tamil: address", text: "இல. 10, காலி வீதி, கொழும்பு 03", font: "NotoTamil" },
];

async function main() {
  registerFonts();
  const out = process.argv[2] ?? "script-shaping.pdf";
  await renderToFile(
    <Document>
      <Page size="A4" style={{ padding: 48, fontFamily: "Inter", fontSize: 11 }}>
        <Text style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Sinhala and Tamil shaping spike</Text>
        {SAMPLES.map((s) => (
          <View key={s.label} style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 8, color: "#6B7280", marginBottom: 3 }}>{s.label}</Text>
            <Text style={{ fontFamily: s.font, fontSize: 20 }}>{s.text}</Text>
          </View>
        ))}
      </Page>
    </Document>,
    out,
  );
  console.info(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
