import { z } from "zod";

/** Organisation details printed on quotations, invoices, reports and emails. */
export const brandingSchema = z.object({
  display_name: z.string().trim().min(2, "Enter a display name.").max(80),
  legal_name: z.string().trim().min(2, "Enter the registered name.").max(160),
  registration_no: z.string().trim().max(60).optional().default(""),
  vat_no: z.string().trim().max(60).optional().default(""),
  address: z.string().trim().max(400).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]).optional().default(""),
  website: z.union([z.literal(""), z.url("Enter a full address, e.g. https://ontriq.lk")]).optional().default(""),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0C5A9A."),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #F75834."),
});

export type Branding = z.infer<typeof brandingSchema>;

export const DEFAULT_BRANDING: Branding = {
  display_name: "Ontriq",
  legal_name: "Ontriq (Pvt) Ltd",
  registration_no: "",
  vat_no: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  primary_color: "#0C5A9A",
  accent_color: "#F75834",
};

export function readBranding(raw: unknown): Branding {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const merged = { ...DEFAULT_BRANDING, ...Object.fromEntries(Object.entries(source).filter(([, v]) => typeof v === "string")) };
  const parsed = brandingSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_BRANDING;
}
