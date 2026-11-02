/**
 * A report made by the assistant, as a PDF: the figures were worked out by code
 * (src/domain/business-report/build.ts) and this only draws them. Key points
 * written by the AI are labelled as such. Plain Node: relative imports only.
 */
import { Document, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { Bullets, C, Callout, ContentPage, H2, LogoLockup, P, registerFonts, s, SectionTitle, StatTiles, Table } from "./pdf-kit";
import type { BusinessReport } from "../../domain/business-report/build";

function ReportPdf({ report: r, preparedFor, preparedOn }: { report: BusinessReport; preparedFor: string; preparedOn: string }) {
  return (
    <Document title={`${r.title}, ${r.period}`} author="Ontriq (Pvt) Ltd">
      <ContentPage title={r.title} section={r.period}>
        <View style={{ marginBottom: 18 }}>
          <LogoLockup height={30} />
        </View>
        <SectionTitle eyebrow={r.scope ?? "Ontriq report"} title={`${r.title}: ${r.period}`} intro={`Prepared for ${preparedFor} on ${preparedOn}.`} />
        <Callout title="The main finding" tone="navy">
          {r.headline}
        </Callout>
        <StatTiles items={r.tiles} />
        {r.points.length ? (
          <View wrap={false}>
            <H2>Key points</H2>
            <Bullets items={r.points} />
            <Text style={[s.small, { marginBottom: 8 }]}>Written by Ask Ontriq from the figures in this report.</Text>
          </View>
        ) : null}
        {r.sections.map((section) =>
          section.rows.length ? (
            <View key={section.title}>
              <View minPresenceAhead={90}>
                <H2>{section.title}</H2>
                {section.intro ? <P style={{ color: C.muted, fontSize: 8.5 }}>{section.intro}</P> : null}
              </View>
              <Table columns={section.columns} rows={section.rows} />
            </View>
          ) : null,
        )}
        <View wrap={false}>
          <H2>About these figures</H2>
          <Bullets items={r.notes} />
        </View>
      </ContentPage>
    </Document>
  );
}

export async function renderBusinessReportPdf(report: BusinessReport, preparedFor: string, preparedOn: string): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportPdf report={report} preparedFor={preparedFor} preparedOn={preparedOn} />);
}
