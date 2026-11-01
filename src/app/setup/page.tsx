import { Suspense } from "react";
import Link from "@/components/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Eyebrow } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { integrationStatus, isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Setup" };

const STEPS = [
  "Create a Supabase project (region: Mumbai, ap-south-1, is closest to Sri Lanka).",
  "Link it: supabase link --project-ref <ref>, then apply the schema: npm run db:push.",
  "Copy the project URL, publishable key and secret key into the environment (.env.local locally, Netlify → Site configuration → Environment variables in production).",
  "Create the first Super Admin: npm run bootstrap:admin -- --email you@ontriq.lk --name \"Your Name\".",
  "Open the printed link, set a password and enrol two-step verification.",
];

export default function SetupPage() {
  return (
    <main className="relative min-h-svh">
      <div aria-hidden className="h-1 brand-gradient-soft" />
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
        <Logo subtitle="Installation" className="text-foreground" />
        <div className="space-y-3">
          <Eyebrow>Setup</Eyebrow>
          <h1 className="font-display text-[2rem] leading-tight font-semibold tracking-tight">Finish setting up Ontriq</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This page appears until the database is connected. No values are shown, only whether each one is set.
          </p>
        </div>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" />}>
          <Status />
        </Suspense>
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
            <CardDescription>Takes about ten minutes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4 text-sm">
              {STEPS.map((s, i) => (
                <li key={s} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-orange/12 text-xs font-semibold text-brand-orange-ink">{i + 1}</span>
                  <span className="pt-0.5 leading-relaxed text-muted-foreground">{s}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

async function Status() {
  await connection();
  // Once the database is connected this page has nothing to say, and what is set up is nobody's business.
  if (isSupabaseConfigured()) redirect("/login");
  const items = integrationStatus();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>{isSupabaseConfigured() ? "The database is connected." : "The database is not connected yet."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.key} className="flex items-start gap-3">
            {item.configured ? <CheckCircle2 className="mt-0.5 size-[18px] text-success" /> : <CircleDashed className="mt-0.5 size-[18px] text-muted-foreground" />}
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {item.label}
                {item.required ? "" : <span className="ml-1.5 text-xs font-normal text-muted-foreground">optional</span>}
              </p>
              <p className="font-mono text-xs text-muted-foreground">{item.envVars.join(" · ")}</p>
            </div>
          </div>
        ))}
        {isSupabaseConfigured() ? (
          <Button asChild variant="brand" size="lg" className="mt-2 h-10 px-5">
            <Link href="/login">Go to sign in</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
