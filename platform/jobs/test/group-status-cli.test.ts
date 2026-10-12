import {it,expect} from 'vitest';
import {validateGroupStatusArguments,executeGroupStatus} from '../src/group-status-cli.js';
it('group status keeps execute read-only intent and strict compatibility bounds',()=>{
 expect(validateGroupStatusArguments(['reports:groups:build','--group= 本地分類 ','--hours=168','--limit=200','--offset=auto','--execute','--json'])).toEqual({group:'本地分類',hours:168,limit:200,offset:'auto',execute:true});
 expect(validateGroupStatusArguments(['reports:groups:build','--group=　','--offset=AUTO'])).toMatchObject({group:'　',offset:'auto'});
 expect(validateGroupStatusArguments(['reports:groups:build','--group='])).toMatchObject({group:undefined,execute:false});
 for(const args of [['--hours=169'],['--hours=0'],['--hours=2junk'],['--limit=201'],['--offset=-1'],['--offset=1000001'],['--sync'],['--group=x','--group=y'],['--execute=true'],['--dry-run','--execute'],['--group=x\ny']])expect(()=>validateGroupStatusArguments(['reports:groups:build',...args])).toThrow();
});
it('legacy remote sync requests are rejected before opening a database',async()=>{
 for(const flag of ['true','1','TRUE','yes','on'])await expect(executeGroupStatus(['reports:groups:build','--execute'],{INGESTION_LEGACY_EXTERNAL_SYNC_ENABLED:flag,DB_PORT:'1'})).rejects.toThrow('Legacy external group sync is unsupported');
});
