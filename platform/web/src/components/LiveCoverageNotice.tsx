import type {ReportMeta} from '../../../api/src/contracts';
/** The partial-log counts for 本頁資料範圍; the meaning of 部分取樣 is in LiveMethod. */
export function liveCoverageNotes(coverage:ReportMeta['coverage']={}):string[]{
 if(!coverage.partialLogEvidence)return [];
 return [`部分取樣：略過日誌 ${String(coverage.skippedLogRows??0)} 筆、格式異常 ${String(coverage.malformedLogRows??0)} 筆、無效取樣 ${String(coverage.invalidLogSamples??0)} 筆、讀取時更新 ${String(coverage.changedLogRows??0)} 筆。峰值僅涵蓋可用取樣，可縮小期間或分類重新查看。`];
}
