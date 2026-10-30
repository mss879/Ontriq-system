"use client";

import { useState, useTransition } from "react";
import { Archive, MoreHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { archiveAssistantThread, renameAssistantThread } from "@/app/(staff)/app/assistant-actions";

/** Rename or archive one conversation. */
export function ThreadMenu({ id, title, onRenamed, onArchived }: { id: string; title: string; onRenamed: (t: string) => void; onArchived: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [pending, start] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label={`Options for ${title}`} className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(title);
              setRenaming(true);
            }}
          >
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              start(async () => {
                const r = await archiveAssistantThread(id);
                if (r.ok) onArchived();
                else toast.error(r.error);
              })
            }
          >
            <Archive /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await renameAssistantThread(id, draft);
                if (r.ok) {
                  onRenamed(draft.trim());
                  setRenaming(false);
                } else toast.error(r.error);
              });
            }}
            className="space-y-4"
          >
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80} autoFocus aria-label="Conversation name" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !draft.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
