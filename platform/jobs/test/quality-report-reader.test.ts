import {expect,it} from 'vitest';
import {assertQualityReadGrants,assertQualityReportIdentity,qualityReaderError} from '../src/quality-report-reader.js';
const grants=(...s:string[])=>s.map(Grant=>({Grant}));
it('accepts only direct read-only grants and rejects writes, roles, PUBLIC rights and grant option',()=>{
 const usage="GRANT USAGE ON *.* TO `reader`@`localhost` IDENTIFIED BY PASSWORD '*NOTAREALHASH'",read="GRANT SELECT ON `youtube_board_ts`.`urt_video` TO `reader`@`localhost`";
 expect(()=>assertQualityReadGrants(grants(usage,read),grants('GRANT USAGE ON *.* TO PUBLIC'),[],'youtube_board_ts')).not.toThrow();
 for(const evil of [read.replace('SELECT','SELECT, UPDATE'),read+' WITH GRANT OPTION',"GRANT `reader_role` TO `reader`@`localhost`",read.replace('SELECT','ALL PRIVILEGES')])expect(()=>assertQualityReadGrants(grants(usage,evil),[],[],'youtube_board_ts')).toThrow();
 expect(()=>assertQualityReadGrants(grants(usage,read),grants('GRANT SELECT ON *.* TO PUBLIC'),[],'youtube_board_ts')).toThrow();
 expect(()=>assertQualityReadGrants(grants(usage,read),[],[{ROLE_NAME:'reader_role'}],'youtube_board_ts')).toThrow();
});
it('allows the reviewed state schema beside a facade but rejects any other server or schema',()=>{
 const writer={host:'db-runtime',server_id:1,port:3306,db:'youtube_board_ts_worker'},reader={...writer,db:'youtube_board_ts'};
 expect(()=>assertQualityReportIdentity(writer,reader,'youtube_board_ts')).not.toThrow();
 for(const patch of [{db:'wrong'},{host:'replica'},{server_id:2},{port:3307}])expect(()=>assertQualityReportIdentity(writer,{...reader,...patch},'youtube_board_ts')).toThrow();
});

it('rejects global/system/unapproved schema reads and wildcard schema variants',()=>{
 const usage="GRANT USAGE ON *.* TO `reader`@`localhost`",grant=(scope:string)=>`GRANT SELECT ON ${scope} TO \`reader\`@\`localhost\``;
 for(const scope of ['*.*','`mysql`.`user`','`youtube_board`.*','`youtube%board_ts`.*','`youtube_boardXts`.*','`youtube\\_board_ts`.*'])expect(()=>assertQualityReadGrants(grants(usage,grant(scope)),[],[],'youtube_board_ts')).toThrow();
 expect(()=>assertQualityReadGrants(grants(usage,grant('`youtube_board_ts`.*')),[],[],'youtube_board_ts')).not.toThrow();
 expect(()=>assertQualityReadGrants(grants(usage,grant('`youtube_board`.`urt_video`')),[],[],'youtube_board_ts','youtube_board')).not.toThrow();
 expect(()=>assertQualityReadGrants(grants('GRANT USAGE ON `youtube_board_ts`.* TO `reader`@`localhost`'),[],[],'youtube_board_ts')).toThrow();
});

it('retains safe driver codes without echoing SQL, connection details or arbitrary driver text',()=>{
 expect(qualityReaderError('unavailable',{code:'ER_QUERY_TIMEOUT',errno:1969,message:'private',sql:'secret'}).message).toBe('unavailable [ER_QUERY_TIMEOUT/1969]');
 expect(qualityReaderError('unavailable',{code:'secret value',errno:NaN}).message).toBe('unavailable');
});
