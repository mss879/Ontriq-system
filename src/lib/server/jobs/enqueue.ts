import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { kickWorker } from "./kick";

/** Queue an email (outbox row + delivery job in one transaction) and wake a worker. */
export async function queueEmail(input: {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  templateKey?: string;
  entityType?: string;
  entityId?: string;
  createdBy?: string;
  orgId?: string;
  replyTo?: string;
  payload?: Json;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("queue_email", {
    p_to: input.to,
    p_subject: input.subject,
    p_html: input.html,
    p_text: input.text,
    p_template_key: input.templateKey,
    p_payload: input.payload ?? {},
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_created_by: input.createdBy,
    p_org: input.orgId,
    p_reply_to: input.replyTo,
  });
  if (error || !data) throw new Error(`queue_email failed: ${error?.message ?? "no id"}`);
  kickWorker();
  return data as string;
}

export async function enqueueJob(input: {
  kind: string;
  payload?: Json;
  idempotencyKey?: string;
  runAfter?: Date;
  entityType?: string;
  entityId?: string;
  orgId?: string;
  createdBy?: string;
  kick?: boolean;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("enqueue_job", {
    p_kind: input.kind,
    p_payload: input.payload ?? {},
    p_idempotency_key: input.idempotencyKey,
    p_run_after: input.runAfter?.toISOString(),
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_org: input.orgId,
    p_created_by: input.createdBy,
  });
  if (error || !data) throw new Error(`enqueue_job failed: ${error?.message ?? "no id"}`);
  if (input.kick !== false) kickWorker();
  return data as string;
}
