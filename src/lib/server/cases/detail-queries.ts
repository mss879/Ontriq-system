import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";

/** Reads used only by the case and check pages. */

export type DocumentCategoryInfo = { key: string; name: string; guide: string; sensitive: boolean };

export const getDocumentCategories = cache(async (): Promise<DocumentCategoryInfo[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("document_categories").select("key, name, guide, sensitive").eq("is_active", true).order("sort");
  return (data ?? []).map((c) => ({ key: c.key, name: c.name, guide: c.guide, sensitive: c.sensitive }));
});
