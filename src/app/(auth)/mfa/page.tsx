import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard, AuthFormSkeleton } from "@/components/auth/auth-card";
import { homeFor, loadViewerState } from "@/lib/server/viewer";
import { safeNextPath } from "@/domain/safe-redirect";
import { MfaPanel } from "./mfa-panel";

export const metadata: Metadata = { title: "Two-step verification" };

export default function MfaPage({ searchParams }: PageProps<"/mfa">) {
  return (
    <Suspense fallback={<AuthFormSkeleton fields={1} />}>
      <Mfa searchParams={searchParams} />
    </Suspense>
  );
}

async function Mfa({ searchParams }: Pick<PageProps<"/mfa">, "searchParams">) {
  await connection(); // session checks compare token expiry with the current time
  const [state, params] = await Promise.all([loadViewerState(), searchParams]);
  if (state.state === "signed-out") redirect("/login");
  if (state.state === "no-access") redirect("/login?error=no-access");
  if (state.state === "invited") redirect("/accept-invite");

  const viewer = state.viewer;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined, homeFor(viewer));
  // Verified already, or the Super Admin has turned two-step off for staff (Settings → Security).
  if (viewer.aal === "aal2" || !viewer.mfaRequired) redirect(next);
  const setup = params.setup === "1";

  return (
    <AuthCard
      title={setup ? "Protect your account" : "Two-step verification"}
      description={
        setup
          ? "Staff accounts hold sensitive candidate data, so every sign-in needs a code from your phone."
          : "Enter the code from your authenticator app to continue."
      }
    >
      <MfaPanel next={next} email={viewer.email} />
    </AuthCard>
  );
}
