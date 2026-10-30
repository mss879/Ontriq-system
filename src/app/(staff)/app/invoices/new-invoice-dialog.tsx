"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createManualInvoice, draftMonthlyInvoice } from "./actions";

type Client = { id: string; name: string; code: string; billing_policy: string };

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

/** Draft a month's invoice for a client billed monthly, or start an empty manual invoice. */
export function NewInvoiceDialog({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("monthly");
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState(lastMonth());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const monthly = clients.filter((c) => c.billing_policy === "monthly_consolidated");

  const go = () => {
    setError(null);
    if (!clientId) return setError("Choose a client.");
    start(async () => {
      const r = tab === "monthly" ? await draftMonthlyInvoice({ clientId, month }) : await createManualInvoice(clientId);
      if (!r.ok) return setError(r.error);
      toast.success(tab === "monthly" ? "Monthly invoice drafted" : "Draft invoice created");
      setOpen(false);
      router.push(`/app/invoices/${r.invoiceId}`);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setClientId("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <FilePlus2 /> New invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Per-case invoices are drafted automatically when a report is released. Use this for monthly billing or extra work.</DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setClientId("");
            setError(null);
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
          </TabsList>
          <TabsContent value="monthly" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Every released case of the month that isn&apos;t billed yet, on one draft.</p>
            <ClientSelect clients={monthly.length ? monthly : clients} value={clientId} onChange={setClientId} />
            {!monthly.length ? <p className="text-xs text-muted-foreground">No client is set to monthly billing; any client can still be billed by month.</p> : null}
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Month
              <Input type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </TabsContent>
          <TabsContent value="manual" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">An empty draft you fill in by hand.</p>
            <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
          </TabsContent>
        </Tabs>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={go} disabled={pending}>
            {pending ? <Spinner /> : null}
            {tab === "monthly" ? "Draft invoice" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientSelect({ clients, value, onChange }: { clients: Client[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      Client
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a client" />
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name} <span className="text-muted-foreground">· {c.code}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
