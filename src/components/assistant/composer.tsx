"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceInput } from "@/components/voice/voice-input";
import { cn } from "@/lib/utils";

/**
 * Type (or dictate, or record) a message. Enter sends, Shift+Enter makes a
 * new line. Words from voice land here for review before sending.
 */
export function Composer({
  onSend,
  onStop,
  streaming,
  canRecord,
  threadId,
  placeholder,
  autoFocus,
  value: controlled,
  onValueChange,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  canRecord: boolean;
  threadId: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  const [own, setOwn] = useState("");
  const value = controlled ?? own;
  const setValue = useCallback((v: string) => (onValueChange ? onValueChange(v) : setOwn(v)), [onValueChange]);
  const [interim, setInterim] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const append = useCallback(
    (text: string) => {
      const cur = latest.current;
      setValue(cur && !/\s$/.test(cur) ? `${cur} ${text}` : `${cur}${text}`);
      area.current?.focus();
    },
    [setValue],
  );

  const submit = () => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="border-t bg-background/80 p-3 backdrop-blur"
    >
      <div className="rounded-xl bg-card ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-ring/50">
        <textarea
          ref={area}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={4000}
          autoFocus={autoFocus}
          placeholder={placeholder ?? "Ask about cases, invoices, your team…"}
          aria-label="Message the assistant"
          className="field-sizing-content block max-h-40 min-h-11 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        {interim && <p className="px-3 pb-1 text-xs text-muted-foreground italic">{interim}…</p>}
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <VoiceInput onText={append} onInterim={setInterim} canRecord={canRecord} threadId={threadId} disabled={streaming} />
          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Enter to send · Shift+Enter for a new line</span>
          {streaming ? (
            <Button type="button" size="icon-sm" variant="secondary" onClick={onStop} aria-label="Stop">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" disabled={!value.trim()} aria-label="Send" className={cn(!value.trim() && "opacity-40")}>
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
