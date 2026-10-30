import type { Metadata } from "next";
import "@fontsource/noto-sans-sinhala/400.css";
import "@fontsource/noto-sans-sinhala/600.css";
import "@fontsource/noto-sans-tamil/400.css";
import "@fontsource/noto-sans-tamil/600.css";

/**
 * The candidate's public pages (/c/*). No account and no app chrome; never
 * indexed, never sending the address onward. Sinhala and Tamil fonts load only
 * when those scripts appear (the font files are split by unicode range).
 */
export const metadata: Metadata = {
  title: "Your background verification",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function CandidateLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-svh bg-background" style={{ fontFamily: 'var(--font-inter), "Noto Sans Sinhala", "Noto Sans Tamil", system-ui, sans-serif' }}>
      {children}
    </div>
  );
}
