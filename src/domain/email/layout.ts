/**
 * Branded, table-based HTML email that renders well in Gmail, Outlook and
 * Apple Mail. Pure: shared by the app (previews) and the worker (delivery).
 */

export type EmailBrand = {
  name: string;
  primaryColor: string;
  accentColor?: string;
  /** Absolute URL of a PNG logo (email clients block SVG). Without it the name is set in type. */
  logoUrl?: string;
  footerLines?: string[];
};

export type EmailContent = {
  preheader?: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  note?: string;
};

export const DEFAULT_BRAND: EmailBrand = {
  name: "Ontriq",
  primaryColor: "#0C5A9A",
  accentColor: "#F75834",
  footerLines: ["Ontriq (Pvt) Ltd · A Konnect BPO company", "Background verification · HR · Recruitment · Payroll"],
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

export function renderEmail(content: EmailContent, brand: EmailBrand = DEFAULT_BRAND): { html: string; text: string } {
  const primary = /^#[0-9a-f]{6}$/i.test(brand.primaryColor) ? brand.primaryColor : DEFAULT_BRAND.primaryColor;
  const accent = brand.accentColor && /^#[0-9a-f]{6}$/i.test(brand.accentColor) ? brand.accentColor : DEFAULT_BRAND.accentColor!;
  const logo = brand.logoUrl && /^https?:\/\//i.test(brand.logoUrl)
    ? `<img src="${escapeHtml(brand.logoUrl)}" width="132" alt="${escapeHtml(brand.name)}" style="display:block;width:132px;max-width:132px;height:auto;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-size:20px;font-weight:800;letter-spacing:0.14em;color:#060709;">${escapeHtml(brand.name.toUpperCase())}</span>`;
  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#1f2937;">${escapeHtml(p)}</p>`)
    .join("");
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${primary};">
         <a href="${escapeHtml(safeUrl(content.cta.url))}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(content.cta.label)}</a>
       </td></tr></table>
       <p style="margin:0 0 16px;font-size:12px;line-height:18px;color:#6b7280;">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#374151;">${escapeHtml(safeUrl(content.cta.url))}</span></p>`
    : "";
  const note = content.note
    ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f5f7fa;border-left:3px solid ${accent};border-radius:6px;font-size:13px;line-height:20px;color:#4b5563;">${escapeHtml(content.note)}</p>`
    : "";
  const footer = (brand.footerLines ?? [])
    .map((l) => `<p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9ca3af;">${escapeHtml(l)}</p>`)
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f3f6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(content.preheader ?? content.heading)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f6;padding:32px 12px;"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(10,26,47,0.08);">
    <tr><td style="padding:26px 32px 22px;background:#ffffff;">${logo}</td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:0;background:${accent};background-image:linear-gradient(90deg,#F78F1E,#F75834 40%,#0C5A9A 80%,#0098F3);">&nbsp;</td></tr>
    <tr><td style="padding:32px 32px 28px;">
      <h1 style="margin:0 0 20px;font-size:23px;line-height:31px;font-weight:700;letter-spacing:-0.01em;color:#0a1a2f;">${escapeHtml(content.heading)}</h1>
      ${paragraphs}${cta}${note}
    </td></tr>
    <tr><td style="padding:18px 32px 24px;border-top:1px solid #eef0f4;background:#fafbfc;">${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.cta ? [`${content.cta.label}: ${content.cta.url}`, ""] : []),
    ...(content.note ? [content.note, ""] : []),
    ...(brand.footerLines ?? []),
  ].join("\n");

  return { html, text };
}
