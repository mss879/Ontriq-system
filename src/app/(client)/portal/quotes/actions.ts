"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { clientIp, rateLimit } from "@/lib/server/request-meta";

/**
 * The client's answer to a quotation (0014): accept with a typed signature
 * (name, time and IP are recorded), decline with a reason, or ask a question.
 * The database keeps every answer to the client's own company.
 */

async function acceptor() {
  return requireViewer({ kind: "client", permission: "portal.quotes.accept" });
}

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const viewer = await acceptor();
    if (!(await rateLimit(`quote-answer:${viewer.userId}`, 600, 20))) return fail("Too many attempts. Wait a few minutes and try again.");
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const uuid = z.uuid();
const acceptSchema = z.object({
  name: z.string().trim().min(3, "Type your full name to accept.").max(160),
  agree: z.literal(true, { error: "Tick the box to confirm you may accept on your company's behalf." }),
});

export async function acceptQuote(quoteId: string, input: z.input<typeof acceptSchema>): Promise<ActionResult> {
  return guarded(async () => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const parsed = acceptSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your answer.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("portal_accept_quote", { p_quote: quoteId, p_name: parsed.data.name, p_ip: await clientIp() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const respondSchema = z.object({ action: z.enum(["decline", "question"]), text: z.string().trim().min(3, "Write a short note first.").max(2000) });

export async function respondToQuote(quoteId: string, input: z.input<typeof respondSchema>): Promise<ActionResult> {
  return guarded(async () => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const parsed = respondSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Write a short note first.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("portal_respond_quote", { p_quote: quoteId, p_action: parsed.data.action, p_text: parsed.data.text });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

/** Called once the quotation is on screen (not when it is merely read or prefetched). */
export async function markQuoteViewed(quoteId: string): Promise<void> {
  if (!uuid.safeParse(quoteId).success) return;
  try {
    await requireViewer({ kind: "client" });
  } catch {
    return;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_mark_quote_viewed", { p_quote: quoteId });
  if (!error) refresh();
}
