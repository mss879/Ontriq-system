import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { appOrigin } from "@/lib/env";
import "./globals.css";

// The same pairing as ontriq.com: Inter for text, Stack Sans Notch for display.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const stackSans = localFont({
  src: "./fonts/StackSansNotch-VariableFont_wght.woff2",
  variable: "--font-stack-sans",
  weight: "200 700",
  display: "swap",
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin()),
  title: { default: "Ontriq", template: "%s · Ontriq" },
  description: "Background verification, managed end to end.",
  applicationName: "Ontriq",
  robots: { index: false, follow: false },
  openGraph: {
    siteName: "Ontriq",
    title: "Ontriq",
    description: "Background verification, managed end to end.",
    images: [{ url: "/brand/ontriq-share.png", width: 1200, height: 630, alt: "Ontriq" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f8f9fb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${stackSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
