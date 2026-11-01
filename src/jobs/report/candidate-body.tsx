/**
 * The candidate report's body (react-pdf): what the candidate provided, in the
 * AI's words where it could help, with the facts that came from code set apart
 * from it. The files are appended by assemble.ts. Plain Node: relative imports only.
 */
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { C, LogoLockup, LogoMark, Table, registerFonts, s } from "../documents/pdf-kit";
import type { CandidateReportBody } from "../../domain/candidate/report";

export type CandidateReportModel = {
  org: { name: string; legal_name: string };
  reference: string;
  client: string;
  position: string | null;
  candidate: { full_name: string; nic: string | null; date_of_birth: string | null; email: string | null; phone: string | null; address: string | null };
  version: number;
  confirmedOn: string | null;
  generatedOn: string;
  consent: string;
  answers: { question: string; answer: string }[];
  appendix: { ref: string; title: string; filename: string }[];
  /** Null when the AI is off or couldn't answer: the report still lists what was provided. */
  ai: CandidateReportBody | null;
};

function H2({ children }: { children: string }) {
  return <Text style={s.h2}>{children}</Text>;
}

function KV({ rows }: { rows: [string, string | null][] }) {
  const shown = rows.filter((r): r is [string, string] => Boolean(r[1]));
  return (
    <View style={{ borderWidth: 0.75, borderColor: C.line, borderRadius: 4 }}>
      {shown.map(([label, value], i) => (
        <View key={label} style={{ flexDirection: "row", borderTopWidth: i ? 0.75 : 0, borderTopColor: C.line }} wrap={false}>
          <Text style={{ width: "30%", padding: 6, backgroundColor: C.soft, fontSize: 8.5, color: C.muted }}>{label}</Text>
          <Text style={{ width: "70%", padding: 6, fontSize: 9, color: C.ink }}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function CandidateReportDocument({ m }: { m: CandidateReportModel }) {
  const refs = (list: string[]) => list.join(", ");
  return (
    <Document title={`${m.reference} candidate report`} author={m.org.name} subject="Candidate report">
      <Page size="A4" style={s.page} wrap>
        <View style={s.header} fixed>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <LogoMark size={10} />
            <Text style={s.headerText}>CANDIDATE REPORT</Text>
          </View>
          <Text style={s.headerText}>
            {m.reference} · v{m.version}
          </Text>
        </View>

        <LogoLockup height={30} />
        <Text style={[s.h1, { marginTop: 18, marginBottom: 4 }]}>Candidate report</Text>
        <Text style={{ fontSize: 10, marginBottom: 10 }}>{m.generatedOn}</Text>
        <View style={{ borderLeftWidth: 3, borderLeftColor: C.amber, backgroundColor: C.soft, padding: 10, borderRadius: 3, marginBottom: 12 }} wrap={false}>
          <Text style={{ fontWeight: 600, color: C.ink, marginBottom: 2 }}>Not a verification report</Text>
          <Text>
            This sets out what the candidate provided. {m.org.name} has not verified any of it yet.
            {m.ai ? " The AI wrote the summary and the sections below, so check them against the appendix." : ""}
          </Text>
        </View>

        <KV
          rows={[
            ["Candidate", m.candidate.full_name],
            ["NIC", m.candidate.nic],
            ["Date of birth", m.candidate.date_of_birth],
            ["Address", m.candidate.address],
            ["Phone", m.candidate.phone],
            ["Email", m.candidate.email],
            ["Client", m.client],
            ["Position", m.position],
            ["Confirmed by the candidate", m.confirmedOn ?? "Not confirmed by the candidate"],
            ["Consent", m.consent],
          ]}
        />

        {m.ai ? (
          <>
            <H2>Summary</H2>
            <Text>{m.ai.summary}</Text>
            {m.ai.points_to_check.length ? (
              <View wrap={false}>
                <H2>Points to check</H2>
                {m.ai.points_to_check.map((p, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 6, marginBottom: 3 }}>
                    <Text style={{ color: C.amber }}>•</Text>
                    <Text style={{ flex: 1 }}>
                      {p.note}
                      {p.appendix.length ? ` (${refs(p.appendix)})` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {m.ai.sections.map((section) => (
              <View key={section.title} wrap={section.facts.length > 20}>
                <H2>{section.title}</H2>
                <Table
                  columns={[
                    { label: "Detail", width: 30 },
                    { label: "As provided", width: 56 },
                    { label: "Appendix", width: 14 },
                  ]}
                  rows={section.facts.map((f) => [f.label, f.value, refs(f.appendix) || "Answer"])}
                />
                {section.note ? <Text style={s.small}>{section.note}</Text> : null}
              </View>
            ))}
          </>
        ) : null}

        {m.answers.length ? (
          <View>
            <H2>The candidate&apos;s answers</H2>
            {m.answers.map((a, i) => (
              <View key={i} style={{ marginBottom: 6 }} wrap={false}>
                <Text style={{ fontSize: 8.5, fontWeight: 600, color: C.ink }}>{a.question}</Text>
                <Text>{a.answer}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View>
          <H2>Appendix</H2>
          {m.appendix.length ? (
            <Table
              columns={[
                { label: "Ref", width: 10 },
                { label: "Document", width: 42 },
                { label: "File", width: 48 },
              ]}
              rows={m.appendix.map((a) => [a.ref, a.title, a.filename])}
            />
          ) : (
            <Text>The candidate has not uploaded any files.</Text>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text>{m.org.legal_name} · Strictly confidential · Not a verification report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderCandidateReportBody(m: CandidateReportModel): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<CandidateReportDocument m={m} />);
}
