"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin, serviceRoleKey } from "@/lib/env";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { clientIp, rateLimit } from "@/lib/server/request-meta";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { recoveryEmail } from "@/domain/email/templates";
import { emailBrand } from "@/lib/server/email-brand";
import { safeNextPath } from "@/domain/safe-redirect";

type Membership = { kind: "staff" | "client"; status: "active" | "invited"; mfa_required: boolean; org_name: string } | null;

const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "That password is too long.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
const signInSchema = z.object({
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { email, password, next } = parsed.data;

  const ip = await clientIp();
  if (!(await rateLimit(`login:ip:${ip}`, 600, 30)) || !(await rateLimit(`login:email:${email}`, 600, 8))) {
    return fail("Too many sign-in attempts. Wait a few minutes and try again.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail("That email and password don't match an account.");

  const { data } = await supabase.rpc("my_membership");
  const membership = data as Membership;
  if (!membership) {
    await supabase.auth.signOut();
    return fail("Your account doesn't have access yet. Ask your administrator for an invitation.");
  }

  const home = membership.kind === "client" ? "/portal" : "/app";
  const destination = safeNextPath(next, home);
  if (membership.status === "invited") redirect("/accept-invite");
  if (membership.kind === "staff" && membership.mfa_required) {
    redirect(`/mfa?next=${encodeURIComponent(destination)}`);
  }
  redirect(destination);
}

// ---------------------------------------------------------------------------
// Forgot password: email a one-time recovery link (no account enumeration)
// ---------------------------------------------------------------------------
const forgotSchema = z.object({ email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()) });

export async function requestPasswordReset(
  _prev: ActionResult<{ devLink?: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ devLink?: string }>> {
  const parsed = forgotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { email } = parsed.data;

  const ip = await clientIp();
  if (!(await rateLimit(`reset:ip:${ip}`, 3600, 10)) || !(await rateLimit(`reset:email:${email}`, 3600, 3))) {
    return { ok: true };
  }
  if (!serviceRoleKey()) return fail("Password reset is not configured yet. Ask your administrator.");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) return { ok: true };

  const actionUrl = `${appOrigin()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/reset-password`;
  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle();
  const mail = recoveryEmail({ fullName: profile?.full_name ?? "", orgName: "Ontriq", actionUrl }, emailBrand());
  await queueEmail({ to: [email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "auth.recovery", createdBy: data.user.id });

  const devLink = process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY ? actionUrl : undefined;
  return { ok: true, devLink };
}

// ---------------------------------------------------------------------------
// Reset password (the recovery link has signed the user in)
// ---------------------------------------------------------------------------
const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match.", path: ["confirm"] });

export async function updatePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return fail("This link has expired. Request a new one.");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(error.message.includes("different") ? "Choose a password you haven't used before." : "We couldn't update your password.");

  const { data } = await supabase.rpc("my_membership");
  const membership = data as Membership;
  if (membership?.kind === "staff" && membership.mfa_required) redirect("/mfa?next=/app");
  redirect(membership?.kind === "client" ? "/portal" : "/app");
}

// ---------------------------------------------------------------------------
// Accept an invitation: set name and password, activate the membership
// ---------------------------------------------------------------------------
const acceptSchema = z
  .object({ fullName: z.string().trim().min(2, "Enter your full name.").max(120), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match.", path: ["confirm"] });

export async function acceptInvitation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = acceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { fullName, password } = parsed.data;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return fail("This invitation link has expired. Ask for a new one.");

  const { error } = await supabase.auth.updateUser({ password, data: { full_name: fullName } });
  // A retry after a partial failure re-sends the same password; that is fine here.
  if (error && error.code !== "same_password") return fail("We couldn't save your password. Try a different one.");
  if (error) await supabase.auth.updateUser({ data: { full_name: fullName } });
  await supabase.from("profiles").update({ full_name: fullName }).eq("id", userId);
  const { error: acceptError } = await supabase.rpc("accept_my_invitation");
  if (acceptError) return fail("We couldn't activate your account. Ask your administrator to resend the invitation.");

  const { data } = await supabase.rpc("my_membership");
  const membership = data as Membership;
  if (!membership) return fail("This invitation is no longer valid.");
  if (membership.kind === "staff" && membership.mfa_required) redirect("/mfa?next=/app&setup=1");
  redirect(membership.kind === "client" ? "/portal" : "/app");
}

// ---------------------------------------------------------------------------
// Sign out (the client then hard-navigates so no screen state survives)
// ---------------------------------------------------------------------------
export async function signOut(): Promise<ActionResult> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return { ok: true };
}
