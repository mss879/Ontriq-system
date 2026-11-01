"use client";

import { useState, useTransition } from "react";
import Link from "@/components/link";
import { Megaphone, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { draftNudge, sendNudge, type NudgeTone } from "@/app/(staff)/app/team/performance/actions";
import type { OpenItem } from "@/lib/server/performance/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const due = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Colombo" }).format(new Date(iso)) : "No due date";

/** The Push button: a constructive, editable message listing someone's late work. */
export function PushDialog({ userId, name, overdue, size = "sm" }: { userId: string; name: string; overdue: number; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<NudgeTone>("friendly");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<OpenItem[]>([]);
  const [ai, setAi] = useState(false);
  const [email, setEmail] = useState(true);
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();

  const draft = (t: NudgeTone) =>
    startDraft(async () => {
      const res = await draftNudge(userId, t);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMessage(res.message);
      setItems(res.items);
      setAi(res.ai);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) draft(tone);
        else {
          setMessage("");
          setItems([]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={overdue ? "outline" : "ghost"} size={size} aria-label={`Push ${name}`}>
          <Megaphone /> Push
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Push {name}</DialogTitle>
          <DialogDescription>They get an urgent message on their dashboard, even in quiet hours, and can reply.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Late or due soon</p>
            {drafting && !items.length ? (
              <div className="h-12 animate-pulse rounded-xl bg-muted" />
            ) : items.length ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-muted/40 p-2 ring-1 ring-foreground/[0.05]">
                {items.map((i) => (
                  <li key={`${i.kind}-${i.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm">
                    <Link href={`/app/cases/${i.case_id}`} className="min-w-0 truncate hover:text-primary">
                      <span className="font-medium">{i.reference}</span> <span className="text-muted-foreground">{i.label}</span>
                    </Link>
                    <span className="shrink-0 text-xs">
                      {i.overdue ? <Badge className="bg-destructive/10 text-destructive">Overdue</Badge> : <Badge className="bg-warning/15 text-warning-foreground">Due {due(i.due_at)}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">Nothing is late right now. You can still send a message.</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`push-${userId}`}>Message</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={tone}
                  onValueChange={(v) => {
                    setTone(v as NudgeTone);
                    draft(v as NudgeTone);
                  }}
                >
                  <SelectTrigger size="sm" className="h-7 w-28" aria-label="Tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="firm">Firm</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon-sm" onClick={() => draft(tone)} disabled={drafting} aria-label="Draft again">
                  {drafting ? <Spinner /> : <RefreshCw />}
                </Button>
              </div>
            </div>
            <Textarea id={`push-${userId}`} rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={drafting ? "Drafting…" : "Write a short, constructive message."} />
            {ai ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="size-3.5 text-brand-orange" /> Drafted by AI. Read it and edit before sending.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 text-muted-foreground">
              <Checkbox checked disabled aria-label="In the app" /> In the app
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={email} onCheckedChange={(v) => setEmail(v === true)} aria-label="Email" /> Email
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            disabled={sending || drafting || !message.trim()}
            onClick={() =>
              startSend(async () => {
                const res = await sendNudge({ userId, message, channels: email ? ["email"] : [] });
                if (res.ok) {
                  toast.success(`Pushed ${name.split(" ")[0] || name}`);
                  setOpen(false);
                } else toast.error(res.error);
              })
            }
          >
            {sending ? <Spinner /> : <Megaphone />} Send push
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
