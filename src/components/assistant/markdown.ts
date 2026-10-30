/**
 * The small, safe subset of Markdown the assistant writes: paragraphs, bold,
 * inline code, bulleted and numbered lists, and links to pages inside the
 * app. Everything else stays plain text; nothing is ever treated as HTML.
 */

export type Inline = { type: "text"; text: string } | { type: "bold"; text: string } | { type: "code"; text: string } | { type: "link"; text: string; href: string };
export type MdBlock = { type: "p"; inline: Inline[] } | { type: "ul" | "ol"; items: Inline[][] };

/** Only same-app paths: /app/..., /portal/... (no protocol, no protocol-relative). */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^\/(app|portal)(\/[\w\-./?=&%#]*)?$/.test(h) && !h.startsWith("//") ? h : null;
}

const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    if (m[2] !== undefined) out.push({ type: "bold", text: m[2] });
    else if (m[4] !== undefined) out.push({ type: "code", text: m[4] });
    else {
      const href = safeHref(m[7]);
      out.push(href ? { type: "link", text: m[6], href } : { type: "text", text: m[6] });
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((i) => i.text.length > 0);
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ type: "p", inline: parseInline(para.join(" ").replace(/\s+/g, " ").trim()) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ type: list.type, items: list.items.map(parseInline) });
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/^#{1,6}\s+/, "");
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (b || n) {
      endPara();
      const type = b ? "ul" : "ol";
      if (!list || list.type !== type) {
        endList();
        list = { type, items: [] };
      }
      list.items.push((b ?? n)![1].trim());
    } else if (!line.trim()) {
      endPara();
      endList();
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      endList();
      para.push(line.trim());
    }
  }
  endPara();
  endList();
  return blocks.filter((b) => (b.type === "p" ? b.inline.length > 0 : b.items.length > 0));
}
