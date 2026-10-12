import { assertTestDatabaseUrl } from '../../shared/test-database.js';
/** Synthetic data; only the isolated rewrite DB is accepted. */
import mysql from 'mysql2/promise';
import { taipeiDate, taipeiSql } from '../src/reports/normalize.js';
export async function seedFixture(url: string, now = new Date('2026-10-11T10:00:00Z')) {
    assertTestDatabaseUrl(url);
    const db = await mysql.createConnection(url), day = taipeiDate(now), stamp = taipeiSql(now), old = taipeiSql(new Date(+now - 7200000));
    try {
        for (const id of [990001, 990002]) {
            for (const table of ['urt_channel', 'urt_count', 'urt_channel_ai'])
                await db.execute(`DELETE FROM ${table} WHERE u_id=?`, [id]);
            const name = id === 990001 ? '範例新聞甲（合成）' : '範例新聞乙（合成）';
            await db.execute('INSERT INTO urt_channel(u_id,ctime,mtime,stime,youtube_id,title,description)VALUES(?,?,?,?,?,?,?)', [id, stamp, stamp, stamp, `UCSynthetic${id}`, name, '僅供本機重寫驗證，非真實 YouTube 頻道']);
            await db.execute('INSERT INTO urt_count(u_id,ctime,mtime,viewCount,subscriberCount,videoCount,view_week,view_month,tags)VALUES(?,?,?,?,?,?,?,?,?)', [id, stamp, stamp, 10000, 100, 2, id === 990001 ? 1000 : 500, 5000, '[990001]']);
            await db.execute('INSERT INTO urt_channel_ai(pk,u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json)VALUES(?,?,?,?,?,?,?,?,?)', [id, id, stamp, day + ' 00:00:00', day + ' 23:59:59', 'fixture', 'oneday', 'synthetic', JSON.stringify([{ 事件: '合成事件：城市交通', videoId: id === 990001 ? ['FixtureAa01', 'Fixtureaa01'] : ['FixtureLive'], 關鍵字: ['交通'], 人物: ['範例人物'] }])]);
        }
        await db.execute('UPDATE urt_channel SET flag_del=0 WHERE u_id=990002');
        await db.execute('DELETE FROM urt_tag WHERE tag_id=990001');
        await db.execute('INSERT INTO urt_tag(tag_id,tag_name,ctime)VALUES(990001,?,?)', ['範例分類（合成）', stamp]);
        for (const [id, uid, title, views] of [['FixtureAa01', 990001, '合成：城市交通規劃', 200], ['Fixtureaa01', 990001, '合成：交通回應', 100], ['FixtureLive', 990002, '合成：交通現場直播', 300], ['FixtureOld1', 990002, '合成：過期直播', 900]] as const) {
            for (const table of ['urt_video', 'urt_video_live', 'urt_video_live_log', 'urt_video_log', 'urt_video_duration'])
                await db.execute(`DELETE FROM ${table} WHERE videoId=?`, [id]);
            await db.execute('INSERT INTO urt_video(ctime,mtime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount,likeCount,commentCount)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [stamp, stamp, uid, id, stamp, `UCSynthetic${uid}`, title, '', uid === 990001 ? '範例新聞甲（合成）' : '範例新聞乙（合成）', 'PLSynthetic', 0, id, '合成資料：川普談交通建設', views, 5, 2]);
            await db.execute('INSERT INTO urt_video_duration(ctime,u_id,videoId,duration,caption)VALUES(?,?,?,?,?)', [stamp, uid, id, 120, 'false']);
            await db.execute('INSERT INTO urt_video_log(ctime,videoId,themonth,thedata)VALUES(?,?,?,?)', [stamp, id, day.slice(0, 7) + '-01', JSON.stringify({ [day]: { view: views, like: 5, comment: 2 } })]);
            if (id === 'FixtureLive' || id === 'FixtureOld1')
                await db.execute('INSERT INTO urt_video_live(ctime,mtime,publishedAt,videoId,u_id,actualStartTime,concurrentViewers,max_current)VALUES(?,?,?,?,?,?,?,?)', [stamp, id === 'FixtureOld1' ? old : stamp, stamp, id, uid, old, views, views + 10]);
        }
        await db.execute("UPDATE urt_video SET stime='2026-11-11 18:00:00' WHERE videoId='FixtureAa01'");
        await db.execute('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,max_current,log_json)VALUES(?,?,?,?,?,?)', ['FixtureLive', 990002, day, stamp, null, JSON.stringify({ '17:55': 400, '17:59': 350 })]);
        await db.execute('DELETE FROM urt_ai_date WHERE pk=990001');
        await db.execute('INSERT INTO urt_ai_date(pk,ctime,date_from,date_to,ai_type,data_type,condition_type,user_token,channel_id,result_json)VALUES(?,?,?,?,?,?,?,?,?,?)', [990001, stamp, day + ' 00:00:00', day + ' 23:59:59', 'fixture', 'oneday', 'all', 'synthetic', JSON.stringify({ '990001': '範例新聞甲（合成）', '990002': '範例新聞乙（合成）' }), JSON.stringify([{ 事件: '合成：城市交通議題', 媒體事件: { '範例新聞甲（合成）': ['合成事件：城市交通'], '範例新聞乙（合成）': ['合成事件：城市交通'] } }])]);
        await db.execute('DELETE FROM urt_ai_event WHERE pk=990001');
        await db.execute('INSERT INTO urt_ai_event(pk,aipk,event_name,ctime,prompt_type,result_json,date_from,date_to,ai_type,data_type,user_token)VALUES(990001,990001,?,?,?,?,?,?,?, ?,?)', ['合成：城市交通議題', stamp, 'fixture', '{}', day + ' 00:00:00', day + ' 23:59:59', 'fixture', 'oneday', 'synthetic']);
        await db.execute('INSERT INTO urt_channel_ai(pk,u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json)VALUES(?,?,?,?,?,?,?,?,?)', [990003, 990001, stamp, '2026-10-10 00:00:00', '2026-10-10 23:59:59', 'fixture', 'oneday', 'synthetic', JSON.stringify([{ 事件: '前日合成事件', 人物: ['前日人物'], videoId: ['FixtureAa01'] }])]);
    }
    finally {
        await db.end();
    }
}
