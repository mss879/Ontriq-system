"use client";

import { FileSpreadsheet, UserRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PortalPackage, PortalTemplate } from "@/lib/server/portal/queries";
import { RequestForm } from "./request-form";
import { BulkRequest } from "./bulk-request";

export function NewRequest({ templates, packages, bulkEnabled, initialTemplateId }: { templates: PortalTemplate[]; packages: PortalPackage[]; bulkEnabled: boolean; initialTemplateId?: string }) {
  if (!bulkEnabled) return <RequestForm templates={templates} packages={packages} initialTemplateId={initialTemplateId} />;
  return (
    <Tabs defaultValue="one" className="gap-5">
      <TabsList className="h-10! w-full sm:w-fit">
        <TabsTrigger value="one" className="px-4">
          <UserRound /> One candidate
        </TabsTrigger>
        <TabsTrigger value="many" className="px-4">
          <FileSpreadsheet /> Spreadsheet
        </TabsTrigger>
      </TabsList>
      <TabsContent value="one">
        <RequestForm templates={templates} packages={packages} initialTemplateId={initialTemplateId} />
      </TabsContent>
      <TabsContent value="many">
        <BulkRequest templates={templates} packages={packages} />
      </TabsContent>
    </Tabs>
  );
}
