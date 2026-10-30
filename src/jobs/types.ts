import type { ServiceClient } from "./admin-client";
import type { Database, Json } from "../lib/supabase/database.types";

export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export type JobContext = {
  admin: ServiceClient;
  workerId: string;
  /** Epoch ms after which the worker must stop starting paid steps. */
  deadline: number;
  heartbeat: (progress?: Json) => Promise<void>;
};

export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<Json | void>;

/** Throw for failures that retrying cannot fix (bad payload, missing row). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
