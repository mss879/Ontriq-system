import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ClipboardList } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Surface } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { getStaffViewer } from "@/lib/server/viewer";
import { listCheckTypes } from "@/lib/server/admin/settings";
import { formatDate } from "@/lib/format";
import { can } from "@/domain/permissions";
import { NewCheckTypeDialog } from "./new-check-type-dialog";

export const metadata: Metadata = { title: "Check types" };

export default function CheckTypesPage() {
  return (
    <Page className="max-w-5xl">
      <PageHeader
        eyebrow="Administration"
        title="Check types"
        description="What each check collects, which documents it needs and the results it can have. Publishing creates a new version; cases already running keep the version they started with."
        actions={<NewCheckTypeDialog />}
      />
      <Suspense fallback={<SectionSkeleton rows={7} />}>
        <CheckTypeList />
      </Suspense>
    </Page>
  );
}

async function CheckTypeList() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "check_types.manage")) redirect("/app");
  const types = await listCheckTypes();
  return (
    <Surface>
      <ul className="divide-y">
        {types.map((t) => (
          <li key={t.id}>
            <Link href={`/app/settings/check-types/${t.id}`} className="group flex items-center gap-4 px-5 py-4 hover:bg-muted/30">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
                <ClipboardList className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium group-hover:underline">{t.name}</p>
                  <span className="font-mono text-[11px] text-muted-foreground">{t.key}</span>
                  {t.isBuiltin ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Built in</span> : null}
                  {t.hasDraft ? <ToneChip tone="warning" className="h-5 px-2 text-[11px]">Unpublished changes</ToneChip> : null}
                  {t.archived ? <ToneChip tone="neutral" className="h-5 px-2 text-[11px]">Archived</ToneChip> : null}
                </div>
                <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{t.description || "No description"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.currentVersion ? `Version ${t.currentVersion} · published ${formatDate(t.publishedAt)}` : "Not published yet"}
                  {t.currentVersion
                    ? ` · ${t.fieldCount} ${t.fieldCount === 1 ? "field" : "fields"} · ${t.documentCount} ${t.documentCount === 1 ? "document" : "documents"}${t.slaDays ? ` · ${t.slaDays}-day SLA` : ""}`
                    : ""}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
