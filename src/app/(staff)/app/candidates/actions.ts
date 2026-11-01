"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { parseNic } from "@/domain/nic-core";

/** Candidate directory actions. The database decides who may add someone (candidates.manage). */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const addSchema = z.object({
  clientId: z.uuid("Choose a client."),
  fullName: z.string().trim().min(2, "Enter the candidate's full name.").max(160),
  nic: optional(20),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(160)
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.email("Enter a valid email address.").optional()),
  phone: optional(40).refine((v) => !v || isValidPhoneNumber(v, "LK"), "Enter a valid phone number."),
  address: optional(400),
});

export type AddCandidateInput = z.input<typeof addSchema>;

export async function addCandidate(input: AddCandidateInput): Promise<ActionResult<{ id: string; reused: boolean }>> {
  try {
    await requireViewer({ kind: "staff", permission: "candidates.manage" });
    const parsed = addSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const nic = v.nic ? parseNic(v.nic) : null;
    if (nic && !nic.valid) return fail("Check the highlighted fields.", { nic: [nic.error] });

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_candidate", {
      p: {
        client_id: v.clientId,
        full_name: v.fullName,
        nic: nic?.valid ? nic.display : null,
        nic_canonical: nic?.valid ? nic.canonical : null,
        date_of_birth: nic?.valid ? nic.birthDate : null,
        gender: nic?.valid ? nic.gender : null,
        email: v.email ?? null,
        phone: v.phone ?? null,
        address: v.address ?? null,
      },
    });
    if (error || !data) return fail(rpcErrorMessage(error));
    const result = data as { candidate_id: string; reused: boolean };
    refresh();
    return { ok: true, id: result.candidate_id, reused: result.reused };
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}
