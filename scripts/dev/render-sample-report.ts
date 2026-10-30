/**
 * Development helper: render a draft report for a local case and save it.
 *   npx tsx --env-file=.env.local scripts/dev/render-sample-report.ts ONT-2026-000001 out.pdf
 * Moves the case to the report stage directly in the local database first (local stack only).
 */
import { writeFileSync } from "node:fs";
import { createServiceClient } from "../../src/jobs/admin-client";
import { drainJobs } from "../../src/jobs/run-job";

async function main() {
  const [reference, out = "report.pdf"] = process.argv.slice(2);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("127.0.0.1") && !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("localhost")) {
    throw new Error("local stack only");
  }
  const admin = createServiceClient();
  const { data: c } = await admin.from("cases").select("id, stage").eq("reference", reference).single();
  if (!c) throw new Error(`no case ${reference}`);
  if (c.stage !== "report") {
    await admin.from("case_checks").update({ state: "completed", result: "clear", result_tone: "green", values_valid: true, completed_at: new Date().toISOString(), client_note: "Confirmed with the issuing source." }).eq("case_id", c.id);
    await admin.from("documents").update({ visibility: "report" }).eq("case_id", c.id).in("status", ["uploaded", "accepted"]);
    await admin.from("cases").update({ stage: "report", status_key: "final_report_in_progress" }).eq("id", c.id);
  }
  const { data: version, error } = await admin.rpc("request_report_draft", { p_case: c.id });
  if (error) throw error;
  const r = await drainJobs({ budgetMs: 120_000, reserveMs: 0, maxJobs: 10, workerId: "dev-render", admin });
  const { data: v } = await admin.from("report_versions").select("status, storage_path, page_count, error, sha256").eq("id", version as string).single();
  console.log(JSON.stringify({ processed: r.processed, ...v }));
  if (v?.storage_path) {
    const file = await admin.storage.from("reports").download(v.storage_path);
    writeFileSync(out, Buffer.from(await file.data!.arrayBuffer()));
    console.log(`saved ${out}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
