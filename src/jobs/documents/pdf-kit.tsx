/**
 * Building blocks for Ontriq's "Executive" PDF design (react-pdf). Used by the
 * cost document now and by quotations, invoices and reports later.
 * Plain Node: relative imports only, no next/*.
 */
import path from "node:path";
import { Font, Page, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ComponentProps, ReactNode } from "react";
import { LOGO_COLORS, LOGO_LOCKUP, LOGO_MARK, LOGO_WORDMARK } from "../../domain/brand/logo-paths";

type TextStyle = NonNullable<ComponentProps<typeof View>["style"]>; // View has the plain style type (Text unions in SVG props)

const FONT_DIR = path.join(process.cwd(), "src/jobs/fonts");
let registered = false;

export function registerFonts() {
  if (registered) return;
  registered = true;
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(FONT_DIR, "inter-latin-400-normal.woff"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "inter-latin-500-normal.woff"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "inter-latin-600-normal.woff"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "inter-latin-700-normal.woff"), fontWeight: 700 },
    ],
  });
  // Stack Sans Notch, the display face on ontriq.com (static cuts of the variable font).
  Font.register({
    family: "StackSans",
    fonts: [
      { src: path.join(FONT_DIR, "stack-sans-notch-600.woff"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "stack-sans-notch-700.woff"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "SourceSerif",
    fonts: [
      { src: path.join(FONT_DIR, "source-serif-4-latin-600-normal.woff"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "source-serif-4-latin-700-normal.woff"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "NotoSinhala",
    fonts: [
      { src: path.join(FONT_DIR, "noto-sans-sinhala-sinhala-400-normal.woff"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "noto-sans-sinhala-sinhala-700-normal.woff"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "NotoTamil",
    fonts: [
      { src: path.join(FONT_DIR, "noto-sans-tamil-tamil-400-normal.woff"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "noto-sans-tamil-tamil-700-normal.woff"), fontWeight: 700 },
    ],
  });
  // Keep words whole (no hyphenation of names, codes or amounts).
  Font.registerHyphenationCallback((word) => [word]);
}

/** Ontriq brand colours (logo and ontriq.com) plus the result colours. */
export const C = {
  navy: "#0C5A9A", // Ontriq Blue (logo)
  navyDeep: "#0A1A2F", // website navy, dark brand surfaces
  orange: "#F75834", // website accent
  logoOrange: LOGO_COLORS.orange,
  sky: "#0098F3",
  ink: "#0A1A2F",
  body: "#374151",
  muted: "#6B7280",
  line: "#E3E7EE",
  soft: "#F4F6F9",
  green: "#1F8A5B",
  amber: "#C98A12",
  red: "#C2413A",
  white: "#FFFFFF",
};

export const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9.5, color: C.body, paddingTop: 64, paddingBottom: 56, paddingHorizontal: 48, lineHeight: 1.45 },
  header: { position: "absolute", top: 26, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: C.line, paddingBottom: 8 },
  headerText: { fontSize: 7.5, color: C.muted, letterSpacing: 0.4 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.muted },
  eyebrow: { fontSize: 7.5, fontWeight: 600, color: C.navy, letterSpacing: 1.6, textTransform: "uppercase" },
  h1: { fontFamily: "StackSans", fontWeight: 700, fontSize: 22, color: C.ink, marginBottom: 10, lineHeight: 1.15, letterSpacing: -0.3 },
  h2: { fontFamily: "StackSans", fontWeight: 600, fontSize: 13.5, color: C.ink, marginTop: 16, marginBottom: 6 },
  p: { marginBottom: 8 },
  small: { fontSize: 8, color: C.muted },
  strong: { fontWeight: 600, color: C.ink },
});

function viewBoxSize(viewBox: string) {
  const [, , w, h] = viewBox.split(" ").map(Number);
  return { w, h };
}

/**
 * The Ontriq mark. On dark pages it sits on a white rounded tile so the
 * logo colours stay exact (the website does the same with a white pill).
 */
export function LogoMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const { w, h } = viewBoxSize(LOGO_MARK.viewBox);
  if (onDark) {
    const pad = h * 0.2;
    const side = h + pad * 2;
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${side} ${side}`}>
        <Rect x="0" y="0" width={side} height={side} rx={side * 0.26} fill={C.white} />
        <Path d={LOGO_MARK.orange} fill={LOGO_COLORS.orange} transform={`translate(${(side - w) / 2} ${pad})`} />
        <Path d={LOGO_MARK.markblue} fill={LOGO_COLORS.blue} transform={`translate(${(side - w) / 2} ${pad})`} />
      </Svg>
    );
  }
  return (
    <Svg width={(size * w) / h} height={size} viewBox={LOGO_MARK.viewBox}>
      <Path d={LOGO_MARK.orange} fill={LOGO_COLORS.orange} />
      <Path d={LOGO_MARK.markblue} fill={LOGO_COLORS.blue} />
    </Svg>
  );
}

/** "ONTRIQ" with the blue Q tail; `color` sets the letters (white on dark pages). */
export function Wordmark({ height = 12, color = LOGO_COLORS.ink }: { height?: number; color?: string }) {
  const { w, h } = viewBoxSize(LOGO_WORDMARK.viewBox);
  return (
    <Svg width={(height * w) / h} height={height} viewBox={LOGO_WORDMARK.viewBox}>
      <Path d={LOGO_WORDMARK.word} fill={color} />
      <Path d={LOGO_WORDMARK.qtail} fill={color === LOGO_COLORS.ink ? LOGO_COLORS.blue : "#3D8FDB"} />
    </Svg>
  );
}

/** The full lockup (mark, wordmark, "BY KONNECT BPO") as on ontriq.com. */
export function LogoLockup({ height = 36, ink = LOGO_COLORS.ink }: { height?: number; ink?: string }) {
  const { w, h } = viewBoxSize(LOGO_LOCKUP.viewBox);
  const blue = ink === LOGO_COLORS.ink ? LOGO_COLORS.blue : "#3D8FDB";
  return (
    <Svg width={(height * w) / h} height={height} viewBox={LOGO_LOCKUP.viewBox}>
      <Path d={LOGO_LOCKUP.orange} fill={LOGO_COLORS.orange} />
      <Path d={LOGO_LOCKUP.markblue} fill={blue} />
      <Path d={LOGO_LOCKUP.word} fill={ink} />
      <Path d={LOGO_LOCKUP.qtail} fill={blue} />
      <Path d={LOGO_LOCKUP.tag} fill={ink} />
    </Svg>
  );
}

export function ContentPage({ title, section, children }: { title: string; section: string; children: ReactNode }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.header} fixed>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <LogoMark size={10} />
          <Text style={s.headerText}>{title.toUpperCase()}</Text>
        </View>
        <Text style={s.headerText}>{section}</Text>
      </View>
      {children}
      <View style={s.footer} fixed>
        <Text>Ontriq (Pvt) Ltd · Confidential</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}

export function SectionTitle({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <View style={{ marginBottom: 6 }} minPresenceAhead={80}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 7 }}>
        <View style={{ width: 14, height: 2.5, borderRadius: 2, backgroundColor: C.orange }} />
        <Text style={s.eyebrow}>{eyebrow}</Text>
      </View>
      <Text style={s.h1}>{title}</Text>
      {intro ? <Text style={[s.p, { fontSize: 10.5, color: C.body }]}>{intro}</Text> : null}
    </View>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <Text style={s.h2} minPresenceAhead={60}>
      {children}
    </Text>
  );
}

export function P({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={style ? ([s.p, style] as TextStyle) : s.p}>{children}</Text>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <View style={{ marginBottom: 8 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", marginBottom: 4 }} wrap={false}>
          <Text style={{ width: 12, color: C.orange, fontWeight: 700 }}>•</Text>
          <Text style={{ flex: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export type Column = { label: string; width: number; align?: "left" | "right" | "center" };

export function Table({
  columns,
  rows,
  total,
  zebra = true,
  keepTogether = false,
}: {
  columns: Column[];
  rows: ReactNode[][];
  total?: ReactNode[];
  zebra?: boolean;
  keepTogether?: boolean;
}) {
  const cell = (i: number, content: ReactNode, opts: { bold?: boolean; color?: string; header?: boolean } = {}) => (
    <View key={i} style={{ width: `${columns[i].width}%`, paddingVertical: opts.header ? 5 : 5.5, paddingHorizontal: 7 }}>
      <Text
        style={
          opts.header
            ? { textAlign: columns[i].align ?? "left", fontSize: 7, fontWeight: 600, color: C.muted, letterSpacing: 0.5, textTransform: "uppercase" }
            : { textAlign: columns[i].align ?? "left", fontWeight: opts.bold ? 600 : 400, color: opts.color ?? (opts.bold ? C.ink : C.body) }
        }
      >
        {content}
      </Text>
    </View>
  );
  return (
    <View style={{ borderWidth: 0.75, borderColor: C.line, borderRadius: 4, marginBottom: 10 }} wrap={!keepTogether}>
      <View style={{ flexDirection: "row", backgroundColor: C.soft, borderBottomWidth: 0.75, borderBottomColor: C.line }} fixed>
        {columns.map((c, i) => cell(i, c.label, { header: true }))}
      </View>
      {rows.map((row, r) => (
        <View
          key={r}
          wrap={false}
          minPresenceAhead={r === rows.length - 1 && total ? 24 : 0}
          style={{
            flexDirection: "row",
            backgroundColor: zebra && r % 2 === 1 ? "#FAFBFC" : C.white,
            borderBottomWidth: r === rows.length - 1 && !total ? 0 : 0.5,
            borderBottomColor: C.line,
          }}
        >
          {row.map((content, i) => cell(i, content))}
        </View>
      ))}
      {total ? (
        <View style={{ flexDirection: "row", backgroundColor: "#EDF3F9", borderTopWidth: 0.75, borderTopColor: "#C9DAEC" }} wrap={false}>
          {total.map((content, i) => cell(i, content, { bold: true, color: C.navyDeep }))}
        </View>
      ) : null}
    </View>
  );
}

export function StatTiles({ items, dark = false }: { items: { label: string; value: string; sub?: string }[]; dark?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }} wrap={false}>
      {items.map((t) => (
        <View
          key={t.label}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 6,
            backgroundColor: dark ? "#FFFFFF14" : C.soft,
            borderWidth: dark ? 0.75 : 0,
            borderColor: "#FFFFFF33",
          }}
        >
          <Text style={{ fontSize: 7, lineHeight: 1.3, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase", color: dark ? "#B9C6DA" : C.muted, marginBottom: 6 }}>{t.label}</Text>
          <Text style={{ fontFamily: "StackSans", fontWeight: 700, fontSize: 20, lineHeight: 1.15, color: dark ? C.white : C.navyDeep }}>{t.value}</Text>
          {t.sub ? <Text style={{ fontSize: 7.5, lineHeight: 1.35, color: dark ? "#B9C6DA" : C.muted, marginTop: 4 }}>{t.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function Callout({ title, children, tone = "navy" }: { title: string; children: ReactNode; tone?: "navy" | "green" | "amber" }) {
  const color = tone === "green" ? C.green : tone === "amber" ? C.amber : C.navy;
  return (
    <View style={{ borderLeftWidth: 3, borderLeftColor: color, backgroundColor: C.soft, padding: 10, borderRadius: 3, marginVertical: 8 }} wrap={false}>
      <Text style={{ fontWeight: 600, color: C.ink, marginBottom: 3 }}>{title}</Text>
      <Text>{children}</Text>
    </View>
  );
}
