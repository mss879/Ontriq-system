/**
 * Environment access in one place. Public values are inlined at build time;
 * server values are read lazily so missing optional integrations degrade
 * gracefully (the setup page lists what is missing).
 */

export const publicEnv = {
  // Getters (not constants) so a changed .env is picked up without a restart.
  get supabaseUrl(): string {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  },
  get supabaseKey(): string {
    return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  },
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseKey);
}

export type IntegrationStatus = {
  key: string;
  label: string;
  configured: boolean;
  required: boolean;
  envVars: string[];
  help: string;
};

/** Server-only view of which integrations are configured (never returns values). */
export function integrationStatus(): IntegrationStatus[] {
  const has = (...names: string[]) => names.some((n) => Boolean(process.env[n]));
  return [
    {
      key: "supabase",
      label: "Supabase database and auth",
      configured: isSupabaseConfigured(),
      required: true,
      envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      help: "Project URL and publishable (anon) key from Supabase → Project Settings → API.",
    },
    {
      key: "supabase_service",
      label: "Supabase service key",
      configured: has("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
      required: true,
      envVars: ["SUPABASE_SECRET_KEY"],
      help: "Server-only key used for invitations, candidate links and background jobs.",
    },
    {
      key: "app_origin",
      label: "Public app address",
      configured: has("APP_ORIGIN", "URL"),
      required: true,
      envVars: ["APP_ORIGIN"],
      help: "The address people use to open the system, e.g. https://crm.ontriq.lk.",
    },
    {
      key: "resend",
      label: "Email (Resend)",
      configured: has("RESEND_API_KEY"),
      required: false,
      envVars: ["RESEND_API_KEY", "EMAIL_FROM"],
      help: "Without it, emails are logged instead of sent (invite links appear on screen in development).",
    },
    {
      key: "anthropic",
      label: "AI (Anthropic Claude)",
      configured: has("ANTHROPIC_API_KEY"),
      required: false,
      envVars: ["ANTHROPIC_API_KEY"],
      help: "Powers document reading, drafting and the assistants.",
    },
    {
      key: "jobs",
      label: "Background jobs secrets",
      configured: has("JOBS_WORKER_SECRET") && has("CRON_SECRET"),
      required: false,
      envVars: ["JOBS_WORKER_SECRET", "CRON_SECRET"],
      help: "Protect the worker and the scheduled sweeper on Netlify.",
    },
    {
      key: "sms",
      label: "SMS (Notify.lk)",
      configured: has("NOTIFYLK_USER_ID") && has("NOTIFYLK_API_KEY"),
      required: false,
      envVars: ["NOTIFYLK_USER_ID", "NOTIFYLK_API_KEY", "NOTIFYLK_SENDER_ID"],
      help: "Optional SMS for candidates and urgent alerts.",
    },
  ];
}

export function serviceRoleKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Absolute origin for links in emails, e.g. https://crm.ontriq.lk */
export function appOrigin(): string {
  const origin = process.env.APP_ORIGIN ?? process.env.URL ?? "http://localhost:3000";
  return origin.replace(/\/+$/, "");
}

export const ORG_ID_ONTRIQ = "00000000-0000-4000-8000-000000000001";
