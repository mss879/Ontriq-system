import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { getStaffViewer } from "@/lib/server/viewer";
import { documentCategories, getCheckTypeEditor } from "@/lib/server/admin/settings";
import { can } from "@/domain/permissions";
import { CheckTypeEditor } from "./editor";

export const metadata: Metadata = { title: "Edit check type" };

export default function CheckTypeEditorPage({ params }: PageProps<"/app/settings/check-types/[checkTypeId]">) {
  return (
    <Page className="max-w-5xl">
      <Link href="/app/settings/check-types" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Check types
      </Link>
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <Editor params={params} />
      </Suspense>
    </Page>
  );
}

async function Editor({ params }: Pick<PageProps<"/app/settings/check-types/[checkTypeId]">, "params">) {
  const [viewer, { checkTypeId }] = await Promise.all([getStaffViewer(), params]);
  if (!can(viewer, "check_types.manage")) redirect("/app");
  const data = /^[0-9a-f-]{36}$/.test(checkTypeId) ? await getCheckTypeEditor(checkTypeId) : null;
  if (!data) notFound();
  const categories = await documentCategories();
  return <CheckTypeEditor key={`${data.id}:${data.editingDraft}:${data.currentVersion}`} data={data} categories={categories} />;
}
