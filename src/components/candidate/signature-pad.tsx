"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SignaturePadHandle = { toDataUrl: () => string | null; clear: () => void };

/**
 * A small drawing pad for a signature (pointer events: finger, pen or mouse).
 * Ink is dark on white whatever the theme, so the saved PNG reads like paper.
 */
/** White paper under the ink, so the saved PNG never shows a transparent (black) background. */
function paper(el: HTMLCanvasElement) {
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, el.width, el.height);
  ctx.restore();
}

export function SignaturePad({ ref, label, hint, clearLabel }: { ref: React.Ref<SignaturePadHandle>; label: string; hint: string; clearLabel: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = el.getBoundingClientRect();
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = "#0A1A2F";
      paper(el);
      setEmpty(true);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (empty || !canvas.current ? null : canvas.current.toDataURL("image/png")),
    clear: () => {
      if (canvas.current) paper(canvas.current);
      setEmpty(true);
    },
  }));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={empty}
          onClick={() => {
            if (canvas.current) paper(canvas.current);
            setEmpty(true);
          }}
        >
          <Eraser /> {clearLabel}
        </Button>
      </div>
      <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-input bg-white">
        <canvas
          ref={canvas}
          aria-label={label}
          className="block h-36 w-full touch-none cursor-crosshair"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
            const ctx = e.currentTarget.getContext("2d");
            if (ctx && last.current) {
              ctx.beginPath();
              ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
              ctx.fillStyle = "#0A1A2F";
              ctx.fill();
            }
            setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const ctx = e.currentTarget.getContext("2d");
            const p = point(e);
            if (!ctx) return;
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last.current = p;
          }}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = false;
            last.current = null;
          }}
        />
        {empty ? <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">{hint}</p> : null}
        <span aria-hidden className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-slate-300" />
      </div>
    </div>
  );
}
