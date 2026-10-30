"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MessageCircleQuestion, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { acceptQuote, respondToQuote } from "@/app/(client)/portal/quotes/actions";

/** Accept (typed signature), decline or ask: the client's three answers to a quotation. */
export function PortalQuoteResponse({ quoteId, number, clientName, total, open: canAnswer }: { quoteId: string; number: string; clientName: string; total: string; open: boolean }) {
  const [mode, setMode] = useState<"accept" | "decline" | "question" | null>(null);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {canAnswer ? (
        <>
          <Button variant="brand" size="lg" className="h-10 px-4" onClick={() => setMode("accept")}>
            <CheckCircle2 /> Accept quotation
          </Button>
          <Button variant="outline" size="lg" className="h-10" onClick={() => setMode("decline")}>
            <XCircle /> Decline
          </Button>
        </>
      ) : null}
      <Button variant="ghost" size="lg" className="h-10" onClick={() => setMode("question")}>
        <MessageCircleQuestion /> Ask a question
      </Button>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          {mode === "accept" ? (
            <AcceptForm quoteId={quoteId} number={number} clientName={clientName} total={total} onDone={() => setMode(null)} />
          ) : mode ? (
            <NoteForm quoteId={quoteId} action={mode} onDone={() => setMode(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AcceptForm({ quoteId, number, clientName, total, onDone }: { quoteId: string; number: string; clientName: string; total: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [pending, start] = useTransition();
  function submit() {
    start(async () => {
      const r = await acceptQuote(quoteId, { name, agree: agree as true });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Quotation accepted. Thank you!");
      onDone();
    });
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Accept quotation {number}</DialogTitle>
        <DialogDescription>
          You accept {total} on behalf of {clientName}. We record your name, the time and your network address as your signature.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Your full name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="As you would sign it" />
        </label>
        <label className="flex items-start gap-3 rounded-lg bg-muted/40 p-3 text-sm ring-1 ring-foreground/[0.05]">
          <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
          <span>I confirm I may accept this quotation for {clientName} and agree to its prices and terms.</span>
        </label>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button variant="brand" onClick={submit} disabled={pending || name.trim().length < 3 || !agree}>
          {pending ? <Spinner /> : <CheckCircle2 />} Accept
        </Button>
      </DialogFooter>
    </>
  );
}

function NoteForm({ quoteId, action, onDone }: { quoteId: string; action: "decline" | "question"; onDone: () => void }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  function submit() {
    start(async () => {
      const r = await respondToQuote(quoteId, { action, text });
      if (!r.ok) return void toast.error(r.error);
      toast.success(action === "decline" ? "Quotation declined. Ontriq has been told." : "Question sent. Ontriq will reply by email.");
      onDone();
    });
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{action === "decline" ? "Decline the quotation" : "Ask Ontriq a question"}</DialogTitle>
        <DialogDescription>{action === "decline" ? "A short reason helps Ontriq offer something that suits you better." : "Your question goes to the person who prepared the quotation."}</DialogDescription>
      </DialogHeader>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={action === "decline" ? "e.g. We need a different set of checks" : "Your question"} />
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button variant={action === "decline" ? "destructive" : "brand"} onClick={submit} disabled={pending || text.trim().length < 3}>
          {pending ? <Spinner /> : action === "decline" ? <XCircle /> : <MessageCircleQuestion />} {action === "decline" ? "Decline" : "Send question"}
        </Button>
      </DialogFooter>
    </>
  );
}
