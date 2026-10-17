import type {VideoCommentSummary as Summary} from '../../../api/src/video-analytics-contracts';
import {count,dateTime} from '@/lib/format';
import {videoCommentStatuses} from '@/lib/video-comment-status';
import {Metric,SectionHeading} from './ReportUI';
// The state only; what the counts cover is in VideoMethod (本頁的資料來源與計算方式).
const descriptions:Record<Summary['status'],string>={
 missing:'本站尚無此影片的留言擷取批次。',
 pending:'最新批次仍在擷取中，完成前不公開留言與計數。',
 malformed:'這批來源格式無法解析，收錄數暫時無法確認。',
 oversized:'這批來源超過安全解析上限，不提供留言與作者統計。',
 truncated:'只解析這批的前 20,000 筆留言與回覆。',
 complete:'',
};
export function VideoCommentSummary({summary:s,id}:{summary:Summary;id:string}){
 const c=s.evidenceCoverage,incomplete=Number(c.invalidComments)>0||Number(c.invalidCommentTimes)>0||c.commentCountMismatch===true||c.malformedAuthorMetadata===true;
 return <>
  <SectionHeading title="本站留言收錄" href={`/videos/${encodeURIComponent(id)}/analytics`}/>
  <section className="panel" aria-label="本站留言收錄摘要">
   <p><strong>{videoCommentStatuses[s.status]}</strong>{descriptions[s.status]&&<> · {descriptions[s.status]}</>}</p>
   <div className="metrics">
    <Metric label="已解析留言與回覆" value={count(s.decodedCount)} unit="則" detail={`來源批次記錄 ${count(s.recordedCount)} 則`}/>
    <Metric label="已解析留言帳號" value={count(s.decodedAuthors)} unit="個" detail={`來源批次記錄 ${count(s.recordedAuthors)} 個`}/>
    <Metric label="留言批次更新" value={dateTime(s.updatedAt)} detail={s.latestAt?`來源記錄最新留言 ${dateTime(s.latestAt)}`:'尚無來源最新留言時間'}/>
   </div>
   {incomplete&&<p className="muted">來源記錄與可解析範圍有差異，見觀測分析。</p>}
  </section>
 </>;
}
