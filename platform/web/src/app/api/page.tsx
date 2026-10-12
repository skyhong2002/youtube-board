import ApiTabs from '@/components/ApiTabs';
import { Blocks, SubSection, docLink } from '@/components/ApiDocument';
import { plainText } from '@/lib/api-docs';
import { loadApiDocs } from '@/lib/api-docs-source';
import { apiDocsMetadata } from '@/lib/seo';

// Human-readable API docs. Everything below the header comes from the generated
// docs/api.md (the same catalog that produces /api/v1/openapi.json); this page keeps no
// endpoint list of its own. Query-free GETs are shareable as the `api` render route.
export const revalidate = 3600;
export const metadata = apiDocsMetadata();

const ATTRIBUTION = '標籤來源：新文易數（tag.observe.tw）';
const pill = 'inline-flex min-h-9 items-center rounded-full border border-zinc-300 px-3 text-sm hover:border-brand-600 hover:text-brand-700 dark:border-zinc-700 dark:hover:border-brand-400 dark:hover:text-brand-400';
const h2Class = 'scroll-mt-24 text-lg font-semibold';

export default function ApiDocsPage() {
  const doc = loadApiDocs();
  // The generated document carries its own 使用規則 section; the outline adds nothing.
  const outline = doc.sections.map(({ id, title }) => ({ id, title }));
  // The generated intro normally names the tag source already; never print it twice.
  const attributed = doc.intro.some((block) => block.kind === 'paragraph' && plainText(block.text).includes(ATTRIBUTION));
  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-x-12 lg:gap-y-6 lg:space-y-0">
      <div className="lg:col-span-2">
        <ApiTabs current="docs" />
      </div>
      <div className="min-w-0 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            公開、唯讀的 YouTube 觀測資料。本頁內容由 OpenAPI 目錄產生的 docs/api.md 呈現，與機器可讀規格同一來源；完整限制以 OpenAPI 規格為準。
          </p>
          {!attributed && <p className="text-sm text-zinc-600 dark:text-zinc-400">{ATTRIBUTION}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <a href="/api/v1/openapi.json" className={pill}>OpenAPI 3.1 規格</a>
            <a href="/api/v1" className={pill}>端點索引 JSON</a>
            <a href="/api/status" className={pill}>API 狀態</a>
          </div>
        </header>

        <nav aria-label="本頁目錄" className="lg:hidden">
          <details className="rounded-lg border border-zinc-300 dark:border-zinc-800">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">本頁目錄</summary>
            <ul className="space-y-1 px-3 pb-3 text-sm">
              {outline.map((entry) => (
                <li key={entry.id}><a href={`#${entry.id}`} className={docLink}>{plainText(entry.title)}</a></li>
              ))}
            </ul>
          </details>
        </nav>

        {doc.intro.length > 0 && <Blocks blocks={doc.intro} label={plainText(doc.title)} />}

        {doc.sections.map((section) => (
          <section key={section.id} aria-labelledby={section.id} className="min-w-0 space-y-3">
            <h2 id={section.id} className={h2Class}>{plainText(section.title)}</h2>
            <Blocks blocks={section.blocks} label={plainText(section.title)} />
            {section.children.length > 0 && (
              <div className="space-y-2">
                {section.children.map((child) => <SubSection key={child.id} section={child} />)}
              </div>
            )}
          </section>
        ))}
      </div>
      <nav aria-label="本頁目錄" className="hidden lg:block">
        <ul className="sticky top-24 space-y-1.5 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800">
          {outline.map((entry) => (
            <li key={entry.id}>
              <a href={`#${entry.id}`} className="text-zinc-600 hover:text-brand-700 dark:text-zinc-400 dark:hover:text-brand-400">{plainText(entry.title)}</a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
