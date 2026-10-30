import "server-only";
import { DEFAULT_BRAND, type EmailBrand } from "@/domain/email/layout";
import { appOrigin } from "@/lib/env";

/** The email brand with the hosted PNG logo (email clients block SVG). */
export function emailBrand(): EmailBrand {
  return { ...DEFAULT_BRAND, logoUrl: `${appOrigin()}/brand/ontriq-logo.png` };
}
