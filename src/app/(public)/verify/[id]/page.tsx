import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { BadgeCheck, CircleHelp, History, Lock, ShieldAlert } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { clientIp, rateLimit } from "@/lib/server/request-meta";
import { verifyReport, type VerifyResult } from "@/lib/server/reports/queries";
import { FileCheck } from "./file-check";

export const metadata: Metadata = {
  title: "Verify a report",
  description: "Check that an Ontriq background verification report is genuine.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The page behind the QR code on every final report. Anyone may open it; it
 * shows only what proves the report genuine (never the result or the
 * candidate's full name) and compares a file's fingerprint in the browser.
 */
export default function VerifyPage({ params }: PageProps<"/verify/[id]">) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div aria-hidden className="h-1 brand-gradient-soft" />
      <header className="border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <LogoLockup tagline={false} className="h-6 text-foreground" />
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden /> Report verification
          </span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 md:py-12">
        <Suspense fallback={<Skeleton />}>
          <Result params={params} />
        </Suspense>
      </main>
      <footer className="border-t">
        <p className="mx-auto max-w-2xl px-4 py-5 text-xs text-muted-foreground">
          Ontriq (Pvt) Ltd · Background verification. This page confirms a report’s authenticity only. For anything about the verification itself, contact the company that
          requested it.
        </p>
      </footer>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="h-56 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

async function Result({ params }: Pick<PageProps<"/verify/[id]">, "params">) {
  await connection();
  const { id } = await params;
  if (!(await rateLimit(`verify:${await clientIp()}`, 600, 60))) {
    return <Status tone="neutral" icon={<CircleHelp className="size-6" />} title="Too many checks" body="Please wait a few minutes and open the link again." />;
  }
  const result: VerifyResult = UUID.test(id) ? await verifyReport(id) : { found: false };

  if (!result.found || result.status === "not_released") {
    return (
      <Status
        tone="danger"
        icon={<ShieldAlert className="size-6" />}
        title="We can't find this report"
        body="No released Ontriq report matches this code. If someone gave you a report with this code, it may not be genuine: contact Ontriq before relying on it."
      />
    );
  }

  if (result.status === "erased") {
    return (
      <Status
        tone="neutral"
        icon={<History className="size-6" />}
        title="Personal data erased"
        body={`${result.issuer} issued report ${result.reference} for ${result.client}. The candidate's personal data has since been erased under Ontriq's retention policy, so this report can no longer be checked here.`}
      />
    );
  }

  const valid = result.status === "valid";
  const rows: [string, React.ReactNode][] = [
    ["Reference", <span key="r" className="font-mono">{result.reference}</span>],
    ["Version", `v${result.version}`],
    ["Issued by", result.issuer],
    ["Prepared for", result.client],
    ["Candidate", result.candidate ?? "—"],
    ["Released", formatDate(result.releasedAt)],
    ["Pages", result.pageCount ? String(result.pageCount) : "—"],
  ];

  return (
    <div className="space-y-6">
      <Status
        tone={valid ? "success" : "warning"}
        icon={valid ? <BadgeCheck className="size-6" /> : <History className="size-6" />}
        title={valid ? "Genuine report" : "Replaced by a newer version"}
        body={
          valid
            ? `This is a genuine report issued by ${result.issuer}. Compare the details below with the copy you hold.`
            : `${result.issuer} issued this report, then released a revised version that replaces it. Ask ${result.client} for the latest report.`
        }
      />

      <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
        <h2 className="font-display text-base font-semibold">Report details</h2>
        <dl className="mt-4 divide-y text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {result.sha256 ? (
          <div className="mt-4 rounded-xl bg-muted/60 px-3 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">File fingerprint (SHA-256)</p>
            <p className="mt-1 font-mono text-xs break-all">{result.sha256}</p>
          </div>
        ) : null}
      </section>

      {result.sha256 ? (
        <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6">
          <h2 className="font-display text-base font-semibold">Check a file</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">Have the PDF? Check it hasn’t been changed since Ontriq issued it.</p>
          <FileCheck expected={result.sha256} />
        </section>
      ) : null}
    </div>
  );
}

function Status({ tone, icon, title, body }: { tone: "success" | "warning" | "danger" | "neutral"; icon: React.ReactNode; title: string; body: string }) {
  return (
    <section
      className={cn(
        "flex gap-4 rounded-2xl p-5 ring-1 md:p-6",
        tone === "success" && "bg-success/[0.07] ring-success/25",
        tone === "warning" && "bg-warning/10 ring-warning/35",
        tone === "danger" && "bg-destructive/5 ring-destructive/25",
        tone === "neutral" && "bg-card ring-foreground/[0.07]",
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl",
          tone === "success" && "bg-success/15 text-success",
          tone === "warning" && "bg-warning/20 text-warning-foreground dark:text-warning",
          tone === "danger" && "bg-destructive/10 text-destructive",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </section>
  );
}
