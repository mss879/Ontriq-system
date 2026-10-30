import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard, AuthFormSkeleton } from "@/components/auth/auth-card";
import { PasswordForm } from "@/components/auth/password-form";
import { homeFor, loadViewerState } from "@/lib/server/viewer";
import { acceptInvitation } from "../actions";

export const metadata: Metadata = { title: "Set up your account" };

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<AuthFormSkeleton fields={3} />}>
      <AcceptInvite />
    </Suspense>
  );
}

async function AcceptInvite() {
  await connection(); // session checks compare token expiry with the current time
  const state = await loadViewerState();
  if (state.state === "signed-out") redirect("/login?error=link");
  if (state.state === "no-access") redirect("/login?error=no-access");
  if (state.state === "mfa-required") redirect("/mfa");
  if (state.state === "ready") redirect(homeFor(state.viewer));

  const { viewer } = state;
  const where = viewer.kind === "client" ? `${viewer.clientName ?? "your company"}'s client portal` : viewer.orgName;
  return (
    <AuthCard
      title="Set up your account"
      description={
        <>
          You’ve been invited to {where} as <span className="font-medium text-foreground">{viewer.roleName}</span>.
          {viewer.kind === "staff" ? " Next you’ll set up two-step verification." : null}
        </>
      }
    >
      <PasswordForm action={acceptInvitation} submitLabel="Create account" askName defaultName={viewer.fullName} email={viewer.email} />
    </AuthCard>
  );
}
