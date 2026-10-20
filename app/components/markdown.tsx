// Minimal, safe Markdown preview for KB articles: headings, lists, paragraphs, **bold**,
// *italic* and `code`. Builds React elements (no HTML injection).

import { Fragment } from "react";

function inline(text: string) {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) out.push(<strong key={i++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={i++} className="rounded bg-muted px-1 text-[0.9em]">{token.slice(1, -1)}</code>);
    else out.push(<em key={i++}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = source.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={blocks.length} className={list.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
          {list.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </Tag>,
      );
    }
    list = null;
  };
  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const cls = level <= 1 ? "text-lg font-semibold" : level === 2 ? "mt-2 text-base font-semibold" : "text-sm font-semibold";
      blocks.push(
        <p key={blocks.length} className={cls} role="heading" aria-level={level}>
          {inline(heading[2])}
        </p>,
      );
    } else if (bullet || numbered) {
      if (para.length) {
        const p = para;
        para = [];
        blocks.push(<p key={blocks.length}>{inline(p.join(" "))}</p>);
      }
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (!line.trim()) {
      flush();
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <div className="space-y-2 text-sm leading-relaxed text-foreground">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
