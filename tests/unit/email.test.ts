import { describe, expect, it } from "vitest";
import { renderEmail } from "@/domain/email/layout";
import { inviteEmail } from "@/domain/email/templates";

describe("email rendering", () => {
  it("escapes user-supplied text", () => {
    const { html } = renderEmail({ heading: "<script>x</script>", paragraphs: ['Tom & "Jerry"'] });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tom &amp; &quot;Jerry&quot;");
  });

  it("refuses non-http links in buttons", () => {
    const { html } = renderEmail({ heading: "Hi", paragraphs: [], cta: { label: "Go", url: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
  });

  it("builds a client portal invitation with a plain-text twin", () => {
    const mail = inviteEmail({
      fullName: "Nadeesha Perera",
      inviterName: "Ama",
      orgName: "Ontriq",
      roleName: "Client Admin",
      actionUrl: "https://crm.ontriq.lk/auth/confirm?token_hash=abc&type=invite",
      kind: "client",
      clientName: "Hemas Holdings",
    });
    expect(mail.subject).toBe("Your Ontriq client portal access");
    expect(mail.text).toContain("Hello Nadeesha,");
    expect(mail.text).toContain("https://crm.ontriq.lk/auth/confirm?token_hash=abc&type=invite");
    expect(mail.html).toContain("Hemas Holdings");
  });
});
