import type {ReportMeta} from '../../../api/src/contracts';
export function LiveCoverageNotice({coverage={}}:{coverage?:ReportMeta['coverage']}){
 if(!coverage.partialLogEvidence)return null;
 return <aside className="notice"><p>部分直播日誌超出讀取上限、格式無法解析或在讀取時更新。峰值僅涵蓋可用取樣及來源已記錄數字；缺少取樣的時段不代表沒有觀眾。</p><p>略過日誌 {String(coverage.skippedLogRows??0)} 筆 · 格式異常 {String(coverage.malformedLogRows??0)} 筆 · 無效取樣 {String(coverage.invalidLogSamples??0)} 筆 · 讀取時更新 {String(coverage.changedLogRows??0)} 筆。可縮小期間或分類重新查看。</p></aside>;
}
