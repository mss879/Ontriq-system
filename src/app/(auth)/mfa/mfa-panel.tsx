"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { hardNavigate } from "@/lib/client/hard-navigate";

type Mode =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "challenge"; factorId: string }
  | { kind: "error"; message: string };

/** Decide between challenge (factor exists) and a fresh enrolment. No React state here. */
async function startMfaFlow(): Promise<Mode> {
  const supabase = createClient();
  const { data, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { kind: "error", message: "We couldn’t load your security settings. Refresh to try again." };
  const verified = data.totp.find((f) => f.status === "verified");
  if (verified) return { kind: "challenge", factorId: verified.id };
  // Clear half-finished enrolments, then start a fresh one.
  for (const factor of data.all) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Ontriq ${new Date().toISOString().slice(0, 16)}`,
    issuer: "Ontriq",
  });
  if (enrollError || !enrolled) return { kind: "error", message: "We couldn’t start setup. Refresh to try again." };
  return { kind: "enroll", factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret };
}

export function MfaPanel({ next, email }: { next: string; email: string }) {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    startMfaFlow().then((next) => {
      if (active) setMode(next);
    });
    return () => {
      active = false;
    };
  }, []);

  async function verify(value: string) {
    if (mode.kind !== "enroll" && mode.kind !== "challenge") return;
    setVerifying(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: value });
    if (verifyError) {
      setVerifying(false);
      setCode("");
      setError("That code didn't work. Codes change every 30 seconds; try the current one.");
      return;
    }
    // Hard navigation so the server sees the upgraded (aal2) session cookie.
    hardNavigate(next);
  }

  if (mode.kind === "loading") {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner /> Preparing two-step verification…
      </div>
    );
  }
  if (mode.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{mode.message}</AlertDescription>
      </Alert>
    );
  }

  const otp = (
    <div className="space-y-3">
      <InputOTP
        maxLength={6}
        value={code}
        onChange={(value) => {
          setCode(value);
          if (value.length === 6) void verify(value);
        }}
        disabled={verifying}
        autoFocus
        inputMode="numeric"
        pattern="^[0-9]*$"
        aria-label="6-digit code"
      >
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {verifying ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Verifying…
        </p>
      ) : null}
    </div>
  );

  if (mode.kind === "challenge") {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <Smartphone className="mt-0.5 size-5 text-primary" />
          <p className="text-sm text-muted-foreground">
            Open your authenticator app and enter the 6-digit code for <span className="font-medium text-foreground">Ontriq ({email})</span>.
          </p>
        </div>
        {otp}
        <SignOutButton variant="link" className="px-0 text-muted-foreground">
          Not you? Sign out
        </SignOutButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="space-y-5 text-sm">
        <li className="flex gap-3">
          <Step n={1} />
          <span className="text-muted-foreground">
            Install an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.
          </span>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div className="space-y-3">
            <span className="text-muted-foreground">Scan this code with the app.</span>
            <div className="w-fit rounded-xl border bg-white p-3 shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL from Supabase */}
              <img src={mode.qr} alt="QR code for your authenticator app" className="size-40" />
            </div>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(mode.secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-2 rounded-md text-xs text-muted-foreground hover:text-foreground"
            >
              <KeyRound className="size-3.5" />
              Can’t scan? Copy the setup key
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <div className="space-y-3">
            <span className="text-muted-foreground">Enter the 6-digit code the app shows.</span>
            {otp}
          </div>
        </li>
      </ol>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 text-success" />
        Required for all Ontriq staff accounts. You’ll enter a code each time you sign in.
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setMode({ kind: "loading" });
          void startMfaFlow().then(setMode);
        }}
        className="px-0 text-muted-foreground"
      >
        Start over with a new code
      </Button>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{n}</span>
  );
}
