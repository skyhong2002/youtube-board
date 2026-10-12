import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_DOCS_CATALOG_TITLE, API_DOCS_RULES_TITLE, parseApiDocs, type ApiDocument } from './api-docs';
/** platform/docs/api.md, generated from the OpenAPI catalog. Read on the server only (build
 * prerender and ISR regeneration); next.config traces it into the standalone output, whose
 * server chdirs to standalone/web, so `../docs` resolves in dev, build and runtime alike.
 * A missing or malformed file throws: an ISR regeneration then keeps the last good page. */
let cached: ApiDocument | undefined;
export function loadApiDocs(): ApiDocument {
    if (cached) return cached;
    const doc = parseApiDocs(readFileSync(join(process.cwd(), '..', 'docs', 'api.md'), 'utf8'));
    const has = (title: string) => doc.sections.some((s) => s.title === title);
    if (!doc.title || !has(API_DOCS_RULES_TITLE) || !has(API_DOCS_CATALOG_TITLE)) throw new Error('API documentation is malformed');
    return (cached = doc);
}
