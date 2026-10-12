import type { Connection, RowDataPacket } from 'mysql2/promise';
const nullable: Record<string, string[]> = {
  urt_video_schedule:['viewCount','likeCount','commentCount'],
  urt_video:['likeCount','dislikeCount','favoriteCount','commentCount'],
  urt_channel:['commentCount','subscriberCount','videoCount'],
  urt_count:['subscriberCount','videoCount','view_week','sub_week','video_week','view_month','sub_month','video_month','views_pred_week','views_pred_month'],
  urt_video_duration:['duration'], urt_video_live:['concurrentViewers','max_current'], urt_video_live_log:['max_current'],
  urt_comment:['comments_count','likes_count','threads_count','replies_count','authors_count'],
};
const history = ['viewCount','likeCount','dislikeCount','favoriteCount','commentCount'];
/** Preflight migration 007 against the reviewed baseline; abort before any ALTER on schema drift. */
export async function assertSourceCountSchema(db: Pick<Connection,'query'>): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
  const columns = new Map(rows.map(r => [`${r.TABLE_NAME}.${r.COLUMN_NAME}`,r]));
  const verify = (table:string,column:string,allowNull:boolean,types:string[]) => {
    const row=columns.get(`${table}.${column}`);
    if (!row || !types.includes(row.DATA_TYPE) || /unsigned|zerofill/i.test(row.COLUMN_TYPE) || row.IS_NULLABLE !== (allowNull?'YES':'NO') || ![null,'NULL'].includes(row.COLUMN_DEFAULT) || row.EXTRA) throw new Error(`Source migration schema drift: ${table}.${column}`);
    return row;
  };
  for (const [table,columns] of Object.entries(nullable)) for(const column of columns)verify(table,column,true,['int','bigint']);
  for(const column of history)verify('urt_video_log_history',column,false,['int','bigint']);
  for(const table of ['urt_video','urt_channel','urt_count'])verify(table,'viewCount',true,['bigint']);
  const display=verify('urt_comment_author','DisplayName',false,['varchar']);
  if (![32,512].includes(Number(display.CHARACTER_MAXIMUM_LENGTH))) throw new Error('Source migration schema drift: urt_comment_author.DisplayName');
}
