"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { createQuote } from "./actions";

export function NewQuoteDialog({ clients }: { clients: { id: string; name: string; code: string; status: string }[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function create() {
    if (!picked) return;
    start(async () => {
      const r = await createQuote(picked);
      if (!r.ok) return void toast.error(r.error);
      setOpen(false);
      router.push(`/app/quotes/${r.id}`);
    });
  }

  return (
    <>
      <Button variant="brand" size="lg" className="h-9 px-3.5" onClick={() => setOpen(true)}>
        <Plus /> New quotation
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New quotation</DialogTitle>
            <DialogDescription>Choose the client. Prospects can be quoted too; accepting the quotation makes them active.</DialogDescription>
          </DialogHeader>
          <Command className="rounded-xl ring-1 ring-border">
            <CommandInput placeholder="Search clients…" />
            <CommandList className="max-h-72">
              <CommandEmpty>No client matches.</CommandEmpty>
              <CommandGroup>
                {clients.map((c) => (
                  <CommandItem key={c.id} value={`${c.name} ${c.code}`} onSelect={() => setPicked(c.id)} className={cn(picked === c.id && "bg-accent")}>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.code}
                      {c.status === "prospect" ? " · prospect" : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="brand" onClick={create} disabled={!picked || pending}>
              {pending ? <Spinner /> : <Plus />} Start the quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
