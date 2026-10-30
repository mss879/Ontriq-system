import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard, AuthFormSkeleton } from "@/components/auth/auth-card";
import { PasswordForm } from "@/components/auth/password-form";
import { loadViewerState } from "@/lib/server/viewer";
import { updatePassword } from "../actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" description="You'll use it the next time you sign in.">
      <Suspense fallback={<AuthFormSkeleton fields={2} />}>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}

async function ResetForm() {
  await connection(); // session checks compare token expiry with the current time
  const state = await loadViewerState();
  if (state.state === "signed-out") redirect("/login?error=link");
  const email = state.state === "no-access" ? state.email : state.viewer.email;
  return <PasswordForm action={updatePassword} submitLabel="Save password" email={email} />;
}
