import "server-only";
import { createServiceClient } from "@/jobs/admin-client";

/**
 * Service-role client for the few server paths that must bypass RLS:
 * invitations (auth admin API), candidate links, queueing jobs and email.
 * Always authorise the caller with requireViewer() before using it.
 */
export const createAdminClient = createServiceClient;
