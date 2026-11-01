import { homedir } from "node:os";
import path from "node:path";

/** Generated files live outside the repo: writing inside it upsets the dev server's file watcher. */
export const OUT_DIR = process.env.AI_EVAL_DIR ?? path.join(homedir(), ".ontriq/ai-eval");
export const DOC_DIR = path.join(OUT_DIR, "docs");
