/**
 * WebP and HEIC photos as JPEG, for the two things that can't read them: the
 * PDF report and the AI. Phones send HEIC by default. sharp reads WebP; its
 * prebuilt binaries can't read HEIC, so that goes through heic-convert (no
 * native code). Both load on demand. Plain Node.
 */
export async function toJpeg(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  try {
    if (mime === "image/heic" || mime === "image/heif") {
      const { default: convert } = await import("heic-convert");
      const out = await convert({ buffer: bytes as unknown as ArrayBufferLike, format: "JPEG", quality: 0.88 });
      return new Uint8Array(out);
    }
    const { default: sharp } = await import("sharp");
    return new Uint8Array(await sharp(bytes).rotate().jpeg({ quality: 88 }).toBuffer());
  } catch {
    return null;
  }
}
