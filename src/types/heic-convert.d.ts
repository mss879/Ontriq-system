declare module "heic-convert" {
  export default function convert(options: { buffer: ArrayBufferLike; format: "JPEG" | "PNG"; quality?: number }): Promise<ArrayBuffer>;
}
