import { cn } from "@/lib/utils";
import { formatAmount } from "@/domain/pricing/money";
import type { DocumentModel, TemplateKey } from "@/domain/documents/model";
import { Logo } from "@/components/brand/logo";

/**
 * The HTML twin of src/jobs/documents/templates.tsx: the same DocumentModel
 * drawn in the same three designs for live previews (quotation and invoice
 * builders, the portal). Always light, like paper, whatever the app theme.
 */
const THEME: Record<TemplateKey, { header: string; headerInk: string; title: string; rule: string; tableHead: string; bordered: boolean; accentText: string }> = {
  executive: { header: "bg-[#0A1A2F] px-8 pt-7 pb-6", headerInk: "text-white", title: "font-[family-name:var(--font-serif,ui-serif)] font-bold", rule: "h-1 bg-[#F75834]", tableHead: "bg-[#0A1A2F] text-white", bordered: false, accentText: "text-[#0C5A9A]" },
  modern: { header: "bg-white px-8 pt-8 pb-3", headerInk: "text-[#0A1A2F]", title: "font-display font-bold", rule: "mx-8 h-[1.5px] bg-[#0C5A9A]", tableHead: "bg-[#F4F6F9] text-[#6B7280]", bordered: false, accentText: "text-[#0C5A9A]" },
  classic: { header: "bg-white px-8 pt-8 pb-3", headerInk: "text-[#0A1A2F]", title: "font-[family-name:var(--font-serif,ui-serif)] font-bold", rule: "mx-8 h-[1.5px] bg-[#0A1A2F]", tableHead: "bg-[#EEF1F5] text-[#0A1A2F]", bordered: true, accentText: "text-[#0A1A2F]" },
};

export function DocumentPreview({ model: m, template, className }: { model: DocumentModel; template: TemplateKey; className?: string }) {
  const t = THEME[template] ?? THEME.executive;
  const dark = template === "executive";
  return (
    <div className={cn("mx-auto w-full max-w-[720px] overflow-hidden rounded-md bg-white text-[13px] leading-relaxed text-[#374151] shadow-lift ring-1 ring-black/5 [color-scheme:light]", className)}>
      <div className={cn("flex items-start justify-between gap-4", t.header)}>
        <Logo className={cn("h-8", dark ? "text-white" : "text-[#0A1A2F]")} />
        <div className="text-right">
          <p className={cn("text-2xl", t.title, t.headerInk)}>{m.title}</p>
          <p className={cn("mt-0.5 text-xs", dark ? "text-[#C9D6E8]" : "text-[#6B7280]")}>{m.number}</p>
          {m.badge ? (
            <span className={cn("mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-widest", m.badge === "PAID" || m.badge === "ACCEPTED" ? "border-[#1F8A5B] text-[#1F8A5B]" : "border-[#C2413A] text-[#C2413A]")}>
              {m.badge}
            </span>
          ) : null}
        </div>
      </div>
      <div className={t.rule} />
      <div className="space-y-5 px-8 pt-6 pb-8">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-widest text-[#6B7280]">{m.kind === "receipt" ? "RECEIVED FROM" : m.kind === "statement" ? "STATEMENT FOR" : "TO"}</p>
            <p className="mt-1 text-[15px] font-semibold text-[#0A1A2F]">{m.to.name}</p>
            {m.to.lines.map((l, i) => (
              <p key={i} className="text-xs">{l}</p>
            ))}
          </div>
          <dl className={cn("w-full space-y-1 p-3 text-xs sm:w-64", t.bordered ? "border border-[#E3E7EE]" : "rounded-md bg-[#F4F6F9]")}>
            {m.meta.map((x) => (
              <div key={x.label} className="flex justify-between gap-3">
                <dt className="text-[#6B7280]">{x.label}</dt>
                <dd className="font-semibold text-[#0A1A2F]">{x.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {m.subtitle ? <p className={cn("text-lg text-[#0A1A2F]", t.title)}>{m.subtitle}</p> : null}
        {m.intro ? <p className="whitespace-pre-line">{m.intro}</p> : null}
        {m.sections.map((s) => (
          <div key={s.heading}>
            <p className={cn("text-[10px] font-bold tracking-widest", t.accentText)}>{s.heading.toUpperCase()}</p>
            <p className="mt-1 whitespace-pre-line">{s.body}</p>
          </div>
        ))}

        {m.lines.length ? (
          <div className={cn("overflow-x-auto", t.bordered && "border border-[#E3E7EE]")}>
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className={t.tableHead}>
                  <th className="px-2.5 py-2 text-left text-[10px] font-semibold tracking-wide">DESCRIPTION</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold tracking-wide">QTY</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold tracking-wide">UNIT ({m.currency})</th>
                  {m.showDiscount ? <th className="px-2.5 py-2 text-right text-[10px] font-semibold tracking-wide">DISC.</th> : null}
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold tracking-wide">AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((l, i) => (
                  <tr key={i} className={cn("border-t border-[#E3E7EE]", !t.bordered && i % 2 === 1 && "bg-[#FAFBFC]")}>
                    <td className="px-2.5 py-2 text-[#0A1A2F]">{l.description}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{formatAmount(l.unit_price)}</td>
                    {m.showDiscount ? <td className="px-2.5 py-2 text-right tabular-nums">{l.discount_pct ? `${l.discount_pct}%` : ""}</td> : null}
                    <td className="px-2.5 py-2 text-right text-[#0A1A2F] tabular-nums">{formatAmount(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {m.statement ? (
          <div className={cn("overflow-x-auto", t.bordered && "border border-[#E3E7EE]")}>
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className={t.tableHead}>
                  {["DATE", "TYPE", "REFERENCE", "DEBIT", "CREDIT", "BALANCE"].map((h, i) => (
                    <th key={h} className={cn("px-2 py-2 text-[10px] font-semibold", i >= 3 ? "text-right" : "text-left")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.statement.rows.map((r, i) => (
                  <tr key={i} className="border-t border-[#E3E7EE]">
                    {[r.date, r.kind, r.reference, r.debit, r.credit, r.balance].map((v, j) => (
                      <td key={j} className={cn("px-2 py-1.5 tabular-nums", j >= 3 && "text-right", j === 5 && "text-[#0A1A2F]")}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {m.totals.length ? (
          <div className={cn("ml-auto w-full space-y-1 sm:w-72", t.bordered ? "border border-[#E3E7EE] p-2" : "rounded-md bg-[#F4F6F9] p-3")}>
            {m.totals.map((row, i) => (
              <div key={i} className={cn("flex justify-between gap-3", row.strong && "border-t border-[#E3E7EE] pt-1.5 text-[14px] font-bold text-[#0A1A2F]")}>
                <span>{row.label}</span>
                <span className="tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        {m.tiers.length ? (
          <div>
            <p className={cn("text-[10px] font-bold tracking-widest", t.accentText)}>VOLUME DISCOUNTS</p>
            {m.tiers.map((tier, i) => (
              <p key={i} className="mt-1">
                {tier.range}: {tier.discount}
                {tier.note ? ` (${tier.note})` : ""}
              </p>
            ))}
          </div>
        ) : null}
        {m.note ? <p className={cn("border-l-[3px] bg-[#F4F6F9] p-3", dark ? "border-[#F75834]" : "border-[#0C5A9A]")}>{m.note}</p> : null}
        {m.payment.length ? (
          <div>
            <p className="text-[10px] font-bold tracking-widest text-[#0A1A2F]">HOW TO PAY</p>
            {m.payment.map((p, i) => (
              <p key={i} className="text-xs">{p}</p>
            ))}
          </div>
        ) : null}
        {m.closing ? <p className="whitespace-pre-line">{m.closing}</p> : null}
        {m.acceptance ? <p className="rounded border border-[#1F8A5B] p-2.5 font-semibold text-[#1F8A5B]">{m.acceptance}</p> : null}
      </div>
      <div className="border-t border-[#E3E7EE] px-8 py-3 text-[10px] text-[#6B7280]">{m.footer}</div>
    </div>
  );
}
