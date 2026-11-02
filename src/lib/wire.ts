/**
 * Netlify's edge refuses any Server Action request whose body contains
 * "_response", in any case and however it is escaped (its rule against
 * CVE-2025-55182). The app uses that text: the employer_response field, the
 * awaiting_response check state, the verification_response document type,
 * and any key someone creates in Settings. Arguments that can hold it travel
 * as base64 JSON instead, which has no underscore at all.
 *
 * The browser wraps with toWire(); the action unwraps with fromWire().
 */

declare const carried: unique symbol;

/** A value packed for a Server Action. The type parameter is what fromWire() gives back. */
export type Wire<T> = { readonly wire: string; readonly [carried]?: T };

export function toWire<T>(value: T): Wire<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(value) ?? "null");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { wire: btoa(binary) };
}

/** The packed value, or undefined when the input isn't one. Validate the result as you would any input. */
export function fromWire<T>(input: Wire<T> | null | undefined): T | undefined {
  const packed = (input as { wire?: unknown } | null | undefined)?.wire;
  if (typeof packed !== "string") return undefined;
  try {
    const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    return undefined;
  }
}
