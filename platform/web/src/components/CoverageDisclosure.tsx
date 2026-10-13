import {incompleteCoverageNote,type BucketCoverage} from '@/lib/bucket-coverage';

/** Keep the incomplete-observation warning visible beside every chart, while the
 * full date-by-date evidence is available through tag-style native disclosure.
 * This changes presentation only, never the chart values or missing-data rules. */
export function CoverageDisclosure({coverage}:{coverage:readonly BucketCoverage[]}){
 const note=incompleteCoverageNote(coverage);
 if(!note)return null;
 const partial=coverage.filter(c=>c.status==='partial').length;
 const unknown=coverage.filter(c=>c.status==='unknown').length;
 return <div className="space-y-1 text-xs text-amber-900 dark:text-amber-200" data-coverage-disclosure>
  <p>來源觀測：{partial} 個日期未完整、{unknown} 個日期涵蓋未知。虛線與空心點不應與完整觀測直接比較，缺少的桶不補零，也不代表聲量下降。</p>
  <details>
   <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">查看各日期的來源涵蓋與計算限制</summary>
   <p className="mt-1 leading-5 [overflow-wrap:anywhere]">{note}</p>
  </details>
 </div>;
}
