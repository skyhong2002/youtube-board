import TableScroller from './TableScroller';
import { inlineParts, plainText, type DocBlock, type DocSection } from '@/lib/api-docs';
import { table } from '@/lib/table-styles';

// Renders the parsed docs/api.md as React elements only: every string is a text node,
// so nothing from the source document is ever interpreted as HTML.

export const docLink = 'text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600 dark:text-brand-400';
const code = 'rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800';
const border = 'border-b border-zinc-200 align-top dark:border-zinc-800';

/** `wrap` lets long inline code break anywhere in prose; table cells keep it on one line. */
export function Prose({ text, wrap = true }: { text: string; wrap?: boolean }) {
  return (
    <>
      {inlineParts(text).map((part, i) =>
        part.code ? (
          <code key={i} className={wrap ? `${code} break-all whitespace-normal` : code}>
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="min-w-0 max-w-full">
      {lang && <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-zinc-500">{lang}</p>}
      {/* Long lines scroll inside the block, never the viewport. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable code needs keyboard access. */}
      <pre tabIndex={0} className="max-w-full overflow-x-auto rounded-md bg-zinc-900 p-3 text-[13px] leading-relaxed text-zinc-100 dark:bg-zinc-950 dark:ring-1 dark:ring-zinc-800">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Sticky first column; at every width each cell stays on one line (long text is cut
 * with an ellipsis and a full-text title) and the table scrolls sideways inside
 * TableScroller, never the page. */
function Table({ head, rows, label }: { head: string[]; rows: string[][]; label: string }) {
  return (
    <TableScroller card label={`${label}（可左右捲動）`}>
      <table className={`w-full text-left text-sm ${table.nowrap} sm:min-w-[40rem]`}>
        <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400">
          <tr>
            {head.map((h, c) => (
              <th key={h} scope="col" className={`${c === 0 ? table.leadHead : table.cell} ${border} whitespace-nowrap font-medium`}>
                <Prose text={h} wrap={false} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={table.row}>
              {head.map((h, c) =>
                c === 0 ? (
                  <th key={h} scope="row" className={`${table.lead} ${border} text-left font-normal`}>
                    <div className={table.leadBox}>
                      <span className={`block ${table.leadText}`} title={plainText(row[c] ?? '')}>
                        <Prose text={row[c] ?? ''} wrap={false} />
                      </span>
                    </div>
                  </th>
                ) : (
                  <td key={h} className={`${table.cell} ${border} whitespace-nowrap`}>
                    <span className={table.clip} title={plainText(row[c] ?? '')}>
                      <Prose text={row[c] ?? ''} wrap={false} />
                    </span>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

export function Blocks({ blocks, label }: { blocks: DocBlock[]; label: string }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <p key={i} className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                <Prose text={block.text} />
              </p>
            );
          case 'list':
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                {block.items.map((item) => (
                  <li key={item}>
                    <Prose text={item} />
                  </li>
                ))}
              </ul>
            );
          case 'code':
            return <CodeBlock key={i} code={block.code} lang={block.lang} />;
          case 'table':
            return <Table key={i} head={block.head} rows={block.rows} label={label} />;
        }
      })}
    </>
  );
}

/** A generated `###` subsection (one endpoint's parameters, one schema, one example). */
export function SubSection({ section }: { section: DocSection }) {
  const mono = section.title.includes('/');
  return (
    <details id={section.id} className="group scroll-mt-24 rounded-lg border border-zinc-300 dark:border-zinc-800">
      <summary className={`cursor-pointer px-3 py-2 text-sm font-medium break-all ${mono ? 'font-mono' : ''}`}>
        <Prose text={section.title} />
      </summary>
      <div className="min-w-0 space-y-3 px-3 pb-3">
        <Blocks blocks={section.blocks} label={plainText(section.title)} />
      </div>
    </details>
  );
}
