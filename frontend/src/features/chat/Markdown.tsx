/**
 * A tiny Markdown renderer for the field guide's answers: paragraphs, bullet / numbered lists, headings (shown as
 * bold lines), **bold**, *italic*, `code` and [links](url). Builds React elements only, never raw HTML.
 */
import type { ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (/^(\*\*|__).+\1$/.test(part)) return <strong key={k}>{inline(part.slice(2, -2), k)}</strong>;
    if (/^`.+`$/.test(part)) return <code key={k}>{part.slice(1, -1)}</code>;
    if (/^[*_].+[*_]$/.test(part) && part.length > 2) return <em key={k}>{inline(part.slice(1, -1), k)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      return /^https?:\/\//.test(link[2]) ? (
        <a key={k} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      ) : (
        link[1]
      );
    }
    return part;
  });
}

type Block = { kind: 'p' | 'h'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•+]\s+(.*)$/.exec(line);
    const num = /^\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
    } else if (bullet || num) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const last = out[out.length - 1];
      const item = (bullet ?? num)![1];
      if (last && last.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (head) {
      flush();
      out.push({ kind: 'h', text: head[1].replace(/[*_]{2}/g, '') });
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((b, i) => {
        const k = String(i);
        if (b.kind === 'p') return <p key={k}>{inline(b.text, k)}</p>;
        if (b.kind === 'h') return <p key={k}><strong>{inline(b.text, k)}</strong></p>;
        if (!('items' in b)) return null;
        const List = b.kind;
        return (
          <List key={k}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${k}-${j}`)}</li>
            ))}
          </List>
        );
      })}
    </>
  );
}
