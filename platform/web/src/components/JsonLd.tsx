import { serializeJsonLd } from '@/lib/seo';
/** Structured data block. A non-executable type, and the only markup path is
 * serializeJsonLd, which escapes every character that could end the element. */
export default function JsonLd({ data }: { data: object | null }) {
  return data ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} /> : null;
}
