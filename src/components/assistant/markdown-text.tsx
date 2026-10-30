import Link from "next/link";
import { Fragment } from "react";
import { parseMarkdown, type Inline } from "./markdown";

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((i, n) => {
        if (i.type === "bold") return <strong key={n} className="font-semibold">{i.text}</strong>;
        if (i.type === "code") return <code key={n} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{i.text}</code>;
        if (i.type === "link")
          return (
            <Link key={n} href={i.href} className="font-medium text-primary underline-offset-2 hover:underline">
              {i.text}
            </Link>
          );
        return <Fragment key={n}>{i.text}</Fragment>;
      })}
    </>
  );
}

/** The assistant's text, rendered from the safe subset in ./markdown (never as HTML). */
export function MarkdownText({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, n) =>
        b.type === "p" ? (
          <p key={n} className="text-pretty">
            <Inlines items={b.inline} />
          </p>
        ) : b.type === "ul" ? (
          <ul key={n} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines items={it} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={n} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines items={it} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
