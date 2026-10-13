import {expect,it,vi} from 'vitest';
const connect=vi.hoisted(()=>vi.fn());
vi.mock('../src/db/frontend.js',async load=>{
 const real=await load<typeof import('../src/db/frontend.js')>();return {...real,connectEditorialDatabase:connect};
});
import {configuredKeywordReviewRepository} from '../src/keyword-review/config.js';
const valid={APP_ENV:'production',TS_FRONTEND_SCHEMA_MODE:'isolated',TS_KEYWORD_REVIEW_ENABLED:'true',DATABASE_URL:'mysql://report:fixture@db/youtube_board_ts',TS_DATABASE_URL:'mysql://state:fixture@db/youtube_board_ts',AUTH_DATABASE_URL:'mysql://state:fixture@db/youtube_board_ts'};
it('constructs only explicitly enabled isolated own-state repositories, with no connection at startup',()=>{
 expect(configuredKeywordReviewRepository({})).toBeUndefined();
 expect(configuredKeywordReviewRepository({...valid,TS_KEYWORD_REVIEW_ENABLED:'false'})).toBeUndefined();
 expect(configuredKeywordReviewRepository({...valid,TS_FRONTEND_SCHEMA_MODE:undefined})).toBeUndefined();
 expect(configuredKeywordReviewRepository({...valid,TS_DATABASE_URL:'mysql://state:fixture@db/youtube_board'})).toBeUndefined();
 expect(configuredKeywordReviewRepository({...valid,TS_DATABASE_URL:valid.DATABASE_URL,AUTH_DATABASE_URL:valid.DATABASE_URL})).toBeUndefined();
 expect(configuredKeywordReviewRepository({...valid,APP_ENV:'local',TS_DATABASE_URL:undefined,AUTH_DATABASE_URL:undefined})).toBeUndefined();
 expect(configuredKeywordReviewRepository({...valid,TS_DATABASE_URL:'mysql://state:fixture@other-db/youtube_board_ts'})).toBeUndefined();
 expect(configuredKeywordReviewRepository({...valid,AUTH_DATABASE_URL:'mysql://other-state:fixture@db/youtube_board_ts'})).toBeUndefined();
 expect(configuredKeywordReviewRepository(valid)).toBeDefined();expect(connect).not.toHaveBeenCalled();
});
