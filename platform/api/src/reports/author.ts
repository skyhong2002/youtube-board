import { sql } from 'drizzle-orm';
import type { Reader } from '../db/client.js';
import { BadQuery, NotFound, bounded, page } from './query.js';
import { text, integer, latest } from './normalize.js';
import { table, link, type Register } from './table.js';
import { analyzeAuthorComments, authorTaxonomyIds, authorIndex } from './author-analysis.js';
export function registerAuthors(register: Register, reader: Reader) {
    register('/comments/authors/:key', async (p, q) => {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(p.key) || (q.lookup !== undefined && !['channel','ChannelId','channel_id','author','author_id'].includes(String(q.lookup)))) throw new BadQuery('Invalid author ID or lookup mode.');
        page(q); bounded(q.hours,24,1,8760); // Legacy hours is a compatibility field, not an author-index time filter.
        const numeric = ['author','author_id'].includes(String(q.lookup)) || (/^\d+$/.test(p.key) && !['channel','ChannelId','channel_id'].includes(String(q.lookup)));
        if (numeric && !/^\d+$/.test(p.key)) throw new BadQuery('Invalid numeric author ID.');
        const author = (await reader.rows(sql`SELECT author_id,ChannelId,DisplayName,ctime,mtime FROM urt_comment_author WHERE ${numeric ? sql`author_id=${p.key}` : sql`BINARY ChannelId=BINARY ${p.key}`} LIMIT 1`))[0];
        if (!author || !text(author.ChannelId)) throw new NotFound();
        const index = (await reader.rows(sql`SELECT index_json FROM urt_comment_rev WHERE author_id=${author.author_id} LIMIT 1`))[0], parsedIndex = authorIndex(index?.index_json), {ids} = parsedIndex;
        if (ids.length > 5000) throw new BadQuery('Author history exceeds the current 5,000 video review bound.');
        const records = ids.length ? await reader.rows(sql`SELECT videoId,u_id,ctime,mtime,comments_json FROM urt_comment WHERE COALESCE(pageToken,'')='' AND BINARY videoId IN(${sql.join(ids.map(id => sql`BINARY ${id}`), sql`, `)}) ORDER BY pk LIMIT 5001`) : [];
        if (records.length > 5000) throw new BadQuery('Author history exceeds the current 5,000 batch review bound.');
        const analysis = analyzeAuthorComments(records, text(author.ChannelId)), uIds = analysis.channels.map(c => c.uId);
        const channels = uIds.length ? await reader.rows(sql`SELECT c.u_id,c.title FROM urt_channel c WHERE c.u_id IN(${sql.join(uIds.map(id => sql`${id}`),sql`, `)})`) : [];
        const counts = uIds.length ? await reader.rows(sql`SELECT u_id,tags FROM urt_count WHERE u_id IN(${sql.join(uIds.map(id => sql`${id}`),sql`, `)})`) : [];
        const taxonomy = uIds.length ? await reader.rows(sql`SELECT tag_id,tag_name FROM urt_tag WHERE tag_id IN(${sql.join(authorTaxonomyIds.map(id => sql`${id}`),sql`, `)})`) : [];
        const byId = new Map(channels.map(c => [integer(c.u_id),c])), tagsById = new Map(counts.map(c => [integer(c.u_id),text(c.tags)])), names = new Map(taxonomy.map(t => [integer(t.tag_id),text(t.tag_name)])), tagCounts = new Map<number,number>();
        for (const c of analysis.channels) for (const id of new Set([...(tagsById.get(c.uId)??'').matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])))) if (authorTaxonomyIds.includes(id)) tagCounts.set(id,(tagCounts.get(id)??0)+c.videos);
        return table(text(author.DisplayName) + '公開留言', [{ key: 'video', label: '影片' }, { key: 'text', label: '留言' }, { key: 'publishedAt', label: '時間', kind: 'datetime' }, { key: 'likes', label: '喜歡', kind: 'number' }, { key: 'reply', label: '回覆' }], analysis.comments, q, {
          updatedAt: latest(author.mtime,author.ctime,...records.flatMap(r => [r.mtime,r.ctime])),
          metrics: [{label:'索引影片',value:ids.length,unit:'部'},{label:'完整擷取批次',value:records.length,unit:'筆'},{label:'主留言',value:analysis.roots,unit:'則'},{label:'回覆',value:analysis.replies,unit:'則'},{label:'參與頻道',value:analysis.channels.filter(c=>c.total>0).length,unit:'個'},{label:'時間缺漏留言',value:analysis.undated,unit:'則'},{label:'忽略無效索引項目',value:parsedIndex.ignoredEntries,unit:'筆'}],
          sections: [
            {title:'留言時段分布（台北時間）',columns:[{key:'hour',label:'時'},{key:'comments',label:'主留言',kind:'number'},{key:'replies',label:'回覆',kind:'number'},{key:'total',label:'合計',kind:'number'}],rows:analysis.hourly},
            {title:'參與頻道',columns:[{key:'channel',label:'頻道'},{key:'videos',label:'索引完整影片',kind:'number'},{key:'comments',label:'主留言',kind:'number'},{key:'replies',label:'回覆',kind:'number'},{key:'total',label:'合計',kind:'number'}],rows:analysis.channels.filter(c=>c.total>0).map(c=>({channel:link(text(byId.get(c.uId)?.title)||'未知頻道',`/channels/${c.uId}`),videos:c.videos,comments:c.comments,replies:c.replies,total:c.total}))},
            {title:'頻道分類的索引影片分布',columns:[{key:'tag',label:'頻道分類'},{key:'videos',label:'索引完整影片',kind:'number'}],rows:[...tagCounts].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([id,videos])=>({tag:link(names.get(id)||String(id),`/tags/${id}/channels`),videos}))}
          ],
          notes: [...(parsedIndex.keyCountMap ? ['此索引使用影片 ID 為鍵的計次映射，依鍵讀取；這是舊資料格式擴充，與 Laravel 把計次數字當影片 ID 的行為不同。'] : []),'只顯示索引指向且完成擷取的公開留言；同一個人可能有多個帳號，不推定真實身分。','時段、頻道與分類統計使用完整索引歷史，不隨留言分頁改變；hours 為舊網址相容參數，不限制期間。','分類沿用原報表的頻道分類 3、4、5、6、48、49，按索引完整影片計次；多重分類可重複計入，也可能含沒有符合留言的索引影片。這不是 tag.observe.tw 的內容標籤。同分分類依 ID 遞增排序。']
        });
    });
}
