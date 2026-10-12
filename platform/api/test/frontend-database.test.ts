import {it,expect} from 'vitest';
import {frontendDatabases,connectEditorialDatabase} from '../src/db/frontend.js';
const read='mysql://report:fixture@127.0.0.1:3306/youtube_board_ts',write='mysql://state:fixture@127.0.0.1:3306/youtube_board_ts';
it('isolated frontend pins separate read and state principals to the same new schema',()=>{
 expect(frontendDatabases({APP_ENV:'production',TS_FRONTEND_SCHEMA_MODE:'isolated',DATABASE_URL:read,TS_DATABASE_URL:write})).toEqual({reports:read,auth:write,state:write});
 for(const patch of [{TS_FRONTEND_SCHEMA_MODE:'typo'},{TS_DATABASE_URL:read},{TS_DATABASE_URL:read.replace('//report:','//%72eport:')},{TS_DATABASE_URL:write.replace('youtube_board_ts','youtube_board')},{TS_DATABASE_URL:write.replace('127.0.0.1','elsewhere')},{AUTH_DATABASE_URL:write.replace('/youtube_board_ts','/youtube_board_ts_other')},{TS_DATABASE_URL:''},{AUTH_DATABASE_URL:write.replace('//state:','//auth:')},{AUTH_DATABASE_URL:write.replace(':fixture@',':other@')}])expect(()=>frontendDatabases({APP_ENV:'production',TS_FRONTEND_SCHEMA_MODE:'isolated',DATABASE_URL:read,TS_DATABASE_URL:write,...patch})).toThrow();
});
it('production state never falls back to the report URL or legacy writer environment',async()=>{
 expect(()=>frontendDatabases({APP_ENV:'production',DATABASE_URL:read})).toThrow('isolated schema mode');
 expect(()=>frontendDatabases({NODE_ENV:'production',DATABASE_URL:read})).toThrow('isolated schema mode');
 await expect(connectEditorialDatabase({APP_ENV:'production',DATABASE_URL:read,DB_HOST:'production.invalid'})).rejects.toThrow('isolated schema mode');
 expect(frontendDatabases({APP_ENV:'local',DATABASE_URL:read})).toEqual({reports:read,auth:read,state:read});
});
it('auth override remains distinct from editorial state while keeping report queries read-only',()=>{
 const auth=write.replace('//state:','//auth:');expect(frontendDatabases({DATABASE_URL:read,TS_DATABASE_URL:write,AUTH_DATABASE_URL:auth})).toEqual({reports:read,auth,state:write});
});

it('invalid APP_ENV never overrides production environment safeguards',()=>{
 for(const APP_ENV of ['prod','staging',''])expect(()=>frontendDatabases({APP_ENV,NODE_ENV:'production',DATABASE_URL:read})).toThrow('Invalid frontend application environment');
 for(const APP_ENV of ['local','test','preview'])expect(frontendDatabases({APP_ENV,NODE_ENV:'production',DATABASE_URL:read}).state).toBe(read);
});
