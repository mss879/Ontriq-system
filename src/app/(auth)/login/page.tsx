import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthCard, AuthFormSkeleton } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to Ontriq. Staff and client accounts use the same page."
      footer="Need access? Your administrator or account manager can invite you."
    >
      <Suspense fallback={<AuthFormSkeleton />}>
        <LoginFormWithParams searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function LoginFormWithParams({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const notice = typeof params.error === "string" ? params.error : undefined;
  return <LoginForm next={next} notice={notice} />;
}
