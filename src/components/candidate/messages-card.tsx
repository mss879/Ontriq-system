"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { candidateDict, type CandidateLang } from "@/domain/candidate/i18n";
import { postMessage } from "@/app/(candidate)/c/session/actions";
import { errorText } from "./errors";

export type MessageData = { id: string; from: "staff" | "candidate"; body: string; at: string };

/** A simple thread with the Ontriq team. */
export function MessagesCard({ lang, messages }: { lang: CandidateLang; messages: MessageData[] }) {
  const t = candidateDict(lang);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setError(t.errors.messageNeeded);
    setError(null);
    start(async () => {
      const r = await postMessage(body);
      if (!r.ok) {
        setError(errorText(t, r.error));
        toast.error(errorText(t, r.error));
        return;
      }
      setBody("");
    });
  }

  return (
    <div className="rounded-2xl border bg-card shadow-soft">
      {messages.length ? (
        <ol className="max-h-[420px] space-y-3 overflow-y-auto p-4 sm:p-5">
          {messages.map((m) => (
            <li key={m.id} className={cn("flex", m.from === "candidate" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  m.from === "candidate" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
                )}
              >
                <p className={cn("mb-0.5 text-[11px] font-medium", m.from === "candidate" ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {m.from === "candidate" ? t.messages.you : t.messages.team} · {m.at}
                </p>
                <p className="break-words whitespace-pre-wrap">{m.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">{t.messages.empty}</p>
      )}
      <form onSubmit={send} className="space-y-2 border-t p-3 sm:p-4">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t.messages.placeholder}
          rows={2}
          maxLength={4000}
          aria-label={t.messages.placeholder}
          className="min-h-[72px] text-[15px]"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" className="h-10 px-4" disabled={pending}>
            {pending ? <Spinner /> : <Send />} {pending ? t.messages.sending : t.messages.send}
          </Button>
        </div>
      </form>
    </div>
  );
}
