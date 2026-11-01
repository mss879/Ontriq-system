/**
 * WebP and HEIC photos as JPEG, for the two things that can't read them: the
 * PDF report and the AI. Phones send HEIC by default. sharp reads WebP; its
 * prebuilt binaries can't read HEIC, so that goes through heic-convert (no
 * native code). Both load on demand. Plain Node.
 */
/** The EXIF orientation of a JPEG, 1 if it has none. Phones store portraits on their side and flag it. */
export function jpegOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) return 1;
    const size = (b[i + 2] << 8) | b[i + 3];
    const exif = marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === "Exif";
    if (exif) {
      const tiff = i + 10;
      const little = b[tiff] === 0x49;
      const u16 = (at: number) => (little ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]);
      const u32 = (at: number) => (little ? u16(at) + u16(at + 2) * 65536 : u16(at) * 65536 + u16(at + 2));
      const ifd = tiff + u32(tiff + 4);
      for (let n = 0; n < u16(ifd); n += 1) {
        const entry = ifd + 2 + n * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
      }
      return 1;
    }
    i += 2 + size;
  }
  return 1;
}

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
