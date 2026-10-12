import mysql from 'mysql2/promise';
export async function seedExtendedFixture(url: string) {
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1' || u.port !== '23306' || u.pathname !== '/youtube_board_test_rewrite')
        throw new Error('Isolated fixture only');
    const db = await mysql.createConnection(url), stamp = '2026-10-11 18:00:00';
    try {
        await db.execute('DELETE FROM urt_show_cloud WHERE u_id=990001');
        for (const [days, words] of [[7, { 交通: 100, 城市: 10 }], [30, { 交通: 200, 城市: 100 }]] as const)
            await db.execute('INSERT INTO urt_show_cloud(u_id,ctime,mtime,days,keywords_json)VALUES(?,?,?,?,?)', [990001, stamp, stamp, days, JSON.stringify(words)]);
        await db.execute('DELETE FROM urt_log WHERE u_id=990001');
        await db.execute('INSERT INTO urt_log(u_id,ctime,themonth,thedata)VALUES(?,?,?,?)', [990001, stamp, '2026-10-01', JSON.stringify({ '2026-10-09': { view: 100, video: 1 }, '2026-10-11': { view: 300, video: 2 } })]);
        await db.execute("DELETE FROM urt_show_tag_date WHERE tagid='990001'");
        for (const [date, views, count] of [['2026-10-10', 100, 2], ['2026-10-11', 300, 3]] as const)
            await db.execute('INSERT INTO urt_show_tag_date(ctime,mtime,tagid,the_date,count_videos,total_views,tags_result)VALUES(?,?,?,?,?,?,?)', [stamp, stamp, '990001', date, count, views, JSON.stringify({ 交通: count })]);
        for (const [id, pageToken] of [['FixtureAa01', null], ['Fixtureaa01', 'unfinished']] as const) {
            await db.execute('DELETE FROM urt_comment WHERE videoId=?', [id]);
            await db.execute('INSERT INTO urt_comment(videoId,ctime,u_id,pageToken,authors_json)VALUES(?,?,?,?,?)', [id, stamp, 990001, pageToken, JSON.stringify({ synthetic: { ChannelId: 'UCSyntheticAuthor', DisplayName: '合成留言者' } })]);
        }
    }
    finally {
        await db.end();
    }
}
