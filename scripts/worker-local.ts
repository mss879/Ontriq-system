/**
 * Local stand-in for the Netlify worker + sweeper:
 *   npm run worker:local          drain once
 *   npm run worker:local -- --watch   sweep + drain every 30 s
 */
import { createServiceClient } from "../src/jobs/admin-client";
import { drainJobs } from "../src/jobs/run-job";

const watch = process.argv.includes("--watch");
const admin = createServiceClient();

async function cycle() {
  const swept = await admin.rpc("sweep_jobs");
  const result = await drainJobs({ admin, budgetMs: 60_000, reserveMs: 1_000 });
  console.info(new Date().toISOString(), "swept", swept.data, "drained", result);
}

cycle()
  .then(() => {
    if (watch) setInterval(() => void cycle(), 30_000);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
