import { Check, Clock3, FileSearch, ShieldCheck, Sparkles } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo";
import { Eyebrow } from "@/components/layout/page";

const POINTS = [
  { icon: ShieldCheck, title: "Every check, tracked", text: "Education, employment, address, police, NIC, references and sanctions, each with its own status and evidence." },
  { icon: Sparkles, title: "AI that does the legwork", text: "Documents read on upload, data pre-filled, outreach and reports drafted for your review." },
  { icon: FileSearch, title: "Clients see progress live", text: "A private portal for every client, with reports released only after approval." },
];

const PREVIEW = [
  { label: "NIC verification", state: "Clear", tone: "done" },
  { label: "Education", state: "Clear", tone: "done" },
  { label: "Employment · 2 records", state: "In progress", tone: "active" },
  { label: "Police clearance", state: "Awaiting station", tone: "wait" },
] as const;

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
      <aside className="brand-glow relative hidden overflow-hidden text-brand-foreground lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14">
        <div className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-[0.07]" />

        <div className="relative flex items-center justify-between">
          <LogoLockup reversed className="h-14 text-white" />
          <span className="rounded-full p-px brand-gradient">
            <span className="block rounded-full bg-brand px-3.5 py-1 text-xs font-medium text-white/90">Establish. Empower. Excel.</span>
          </span>
        </div>

        <div className="relative max-w-lg space-y-9">
          <div className="space-y-4">
            <Eyebrow tone="onDark">Background verification platform</Eyebrow>
            <h2 className="font-display text-[2.6rem] leading-[1.06] font-semibold tracking-tight text-balance xl:text-5xl">
              Verified, trusted hires. Managed end to end.
            </h2>
          </div>

          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/30 backdrop-blur-sm [@media(max-height:860px)]:hidden" aria-hidden>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <p className="font-mono text-[11px] text-white/50">ONT-2026-000123</p>
                <p className="text-sm font-semibold">Comprehensive package</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80">
                <Clock3 className="size-3" /> Day 3 of 7
              </span>
            </div>
            <ul className="space-y-2.5 pt-3">
              {PREVIEW.map((row) => (
                <li key={row.label} className="flex items-center gap-3 text-[13px]">
                  <span
                    className={
                      row.tone === "done"
                        ? "flex size-5 items-center justify-center rounded-full bg-on-dark-success text-brand"
                        : row.tone === "active"
                          ? "flex size-5 items-center justify-center rounded-full border-2 border-brand-orange"
                          : "flex size-5 items-center justify-center rounded-full border border-white/25"
                    }
                  >
                    {row.tone === "done" ? <Check className="size-3" strokeWidth={3} /> : row.tone === "active" ? <span className="size-1.5 rounded-full bg-brand-orange" /> : null}
                  </span>
                  <span className="flex-1 text-white/85">{row.label}</span>
                  <span className={row.tone === "done" ? "text-on-dark-success" : row.tone === "active" ? "text-brand-peach" : "text-white/45"}>{row.state}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[62%] rounded-full brand-gradient-soft" />
            </div>
          </div>

          <ul className="grid gap-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-brand-peach ring-1 ring-white/10">
                  <Icon className="size-[18px]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-white/65">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/45">© Ontriq (Pvt) Ltd · A Konnect BPO company · Colombo, Sri Lanka</p>
      </aside>

      <main className="relative flex flex-col overflow-hidden px-6 py-8 sm:px-10">
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 brand-gradient-soft lg:hidden" />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-40 size-[28rem] rounded-full bg-[radial-gradient(circle,oklch(0.67_0.2_38/0.10),transparent_65%)] dark:bg-[radial-gradient(circle,oklch(0.67_0.2_38/0.14),transparent_65%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-40 size-[30rem] rounded-full bg-[radial-gradient(circle,oklch(0.6_0.15_248/0.08),transparent_65%)]"
        />
        <div className="relative lg:hidden">
          <LogoLockup tagline={false} className="h-9 text-foreground" />
        </div>
        <div className="relative flex flex-1 items-center justify-center py-10">{children}</div>
        <p className="relative text-center text-xs text-muted-foreground lg:text-left">
          Protected by two-step verification. Activity is recorded for your security.
        </p>
      </main>
    </div>
  );
}
