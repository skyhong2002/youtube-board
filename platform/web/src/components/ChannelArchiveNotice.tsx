import type {ReportMeta} from '@/lib/api';
import {reportStyle as ui} from '@/lib/report-styles';
/** Archiving describes the local channel record, not the YouTube account's status. */
export function ChannelArchiveNotice({coverage}:{coverage:ReportMeta['coverage']}){
 if(coverage.channelStatus!=='archived'||typeof coverage.channelId!=='number'||!Number.isSafeInteger(coverage.channelId)||coverage.channelId<1)return null;
 const title=typeof coverage.channelTitle==='string'&&coverage.channelTitle.trim()?coverage.channelTitle:'頻道 #'+coverage.channelId;
 return <aside className={ui.note} aria-label="封存頻道資料"><p><strong>{title}</strong>的頻道紀錄已封存，本頁保留歷史觀測與分析。資料時間以各報表標示為準。</p>{coverage.channelProfileAvailable===false&&<p>目前不提供頻道概覽，可透過下方選單查看歷史報表。</p>}</aside>;
}
