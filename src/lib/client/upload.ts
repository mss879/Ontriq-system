"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Browser half of a direct-to-Storage upload, shared by the portal and the
 * candidate page (the staff uploader has its own richer dialog). The server
 * action `begin` creates the document row and a signed upload URL; the file
 * goes straight to private Storage; `finalize` confirms it arrived.
 */

export const UPLOAD_ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export type UploadMime = (typeof UPLOAD_ACCEPT)[number];
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** For <input accept>. */
export const UPLOAD_ACCEPT_ATTR = "application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic,.heif";

const BY_EXTENSION: Record<string, UploadMime> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic" };

export function mimeOf(file: File): UploadMime | null {
  if ((UPLOAD_ACCEPT as readonly string[]).includes(file.type)) return file.type as UploadMime;
  if (file.type === "image/heif") return "image/heic";
  return BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export async function sha256Hex(file: Blob): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Quick checks before upload; returns a reason the file can't go, or null. */
export function checkFile(file: File): string | null {
  if (!mimeOf(file)) return "Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).";
  if (file.size > UPLOAD_MAX_BYTES) return "This file is over 25 MB. Try a smaller photo or a PDF.";
  if (file.size < 1024) return "This file looks empty.";
  return null;
}

/**
 * A photo too small or too dark to read well. Best effort: returns a warning or null.
 * (AI classification arrives in Phase 4; this catches the obvious cases now.)
 */
export async function photoQualityWarning(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (Math.min(width, height) < 600) return "This photo is small. Make sure the text is readable, or take it closer.";
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, 64, 64);
    const px = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const mean = sum / (px.length / 4);
    if (mean < 45) return "This photo looks very dark. Try again in better light.";
    return null;
  } catch {
    return null;
  }
}

export type BeginResult = { ok: true; documentId: string; path: string; token: string } | { ok: false; error: string };
export type FinalizeResult = { ok: true } | { ok: false; error: string };

export async function uploadOne(
  file: File,
  begin: (meta: { filename: string; mime: UploadMime; size: number }) => Promise<BeginResult>,
  finalize: (documentId: string, sha256?: string) => Promise<FinalizeResult>,
  onStage?: (stage: "preparing" | "uploading" | "saving") => void,
): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const problem = checkFile(file);
  if (problem) return { ok: false, error: problem };
  const mime = mimeOf(file)!;
  onStage?.("preparing");
  const [hash, begun] = await Promise.all([sha256Hex(file), begin({ filename: file.name, mime, size: file.size })]);
  if (!begun.ok) return begun;
  onStage?.("uploading");
  const sent = await createClient().storage.from("case-files").uploadToSignedUrl(begun.path, begun.token, file, { contentType: mime });
  if (sent.error) return { ok: false, error: "The upload didn't go through. Check your connection and try again." };
  onStage?.("saving");
  const done = await finalize(begun.documentId, hash);
  return done.ok ? { ok: true, documentId: begun.documentId } : done;
}
