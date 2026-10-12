import type {VideoCommentSummary as Summary} from '../../../api/src/video-analytics-contracts';
import {count,dateTime} from '@/lib/format';
import {videoCommentStatuses} from '@/lib/video-comment-status';
import {Metric,SectionHeading} from './ReportUI';
const descriptions:Record<Summary['status'],string>={
 missing:'本站尚無此影片的留言擷取批次；未收錄不代表 YouTube 沒有留言。',
 pending:'最新批次仍在擷取中，完成前不公開其留言或計數。',
 malformed:'這批來源格式無法解析；收錄數暫時無法確認。',
 oversized:'這批來源超過安全解析上限；目前不提供其留言與作者統計。',
 truncated:'這批留言與回覆只解析前 20,000 筆；下方數字僅代表成功解析的範圍。',
 complete:'統計限於本站保存並成功解析的留言與回覆，不等同 YouTube 公開留言總數。',
};
export function VideoCommentSummary({summary:s,id}:{summary:Summary;id:string}){
 const c=s.evidenceCoverage,incomplete=Number(c.invalidComments)>0||Number(c.invalidCommentTimes)>0||c.commentCountMismatch===true||c.malformedAuthorMetadata===true;
 return <>
  <SectionHeading title="本站留言收錄" href={`/videos/${encodeURIComponent(id)}/analytics`}/>
  <section className="panel" aria-label="本站留言收錄摘要">
   <p><strong>{videoCommentStatuses[s.status]}</strong> · {descriptions[s.status]}</p>
   <div className="metrics">
    <Metric label="已解析留言與回覆" value={count(s.decodedCount)} unit="則" detail={`來源批次記錄 ${count(s.recordedCount)} 則`}/>
    <Metric label="已解析留言帳號" value={count(s.decodedAuthors)} unit="個" detail={`來源批次記錄 ${count(s.recordedAuthors)} 個`}/>
    <Metric label="留言批次更新" value={dateTime(s.updatedAt)} detail={s.latestAt?`來源記錄最新留言 ${dateTime(s.latestAt)}`:'尚無來源最新留言時間'}/>
   </div>
   {incomplete&&<p className="muted">來源記錄與可解析範圍有差異；詳細分析列出缺漏、去重與解析限制。此處不推算未收錄留言。</p>}
  </section>
 </>;
}
