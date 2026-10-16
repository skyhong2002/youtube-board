import {createHash} from 'node:crypto';
import {BadQuery} from '../reports/query.js';

/** Public selectors, not authorization tokens. No signature or runtime secret. */
export const VIDEO_CURSOR_MAX_LENGTH=1024;
export const VIDEO_CURSOR_MAX_AGE_MS=24*60*60*1000;
export interface VideoCursor {
 v:1;
 publishedAt:string|null;
 pk:string;
 maxPk:string;
 anchor:string;
 filters:string;
 vocabulary:string|null;
}
const fail=():never=>{throw new BadQuery('Invalid or expired video cursor; restart pagination.');};
/** Keep SQL BIGINT identity lossless; mysql2 returns safe values as numbers. */
export function cursorPk(value:unknown):string {
 const raw=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
 if(typeof raw!=='string'||!/^[1-9]\d{0,19}$/.test(raw)||BigInt(raw)>18446744073709551615n)return fail();
 return raw;
}
/** SQL Taipei wall time, not a JS Date. Preserve all six fractional digits. */
export function cursorTimestamp(value:unknown):string|null {
 if(value===null)return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/.test(value))return fail();
 const date=value.slice(0,10),parsed=Date.parse(date+'T00:00:00Z');
 if(date<'1000-01-01'||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date||Number(value.slice(11,13))>23)return fail();
 return value;
}
export function videoFilterDigest(filters:Record<string,unknown>):string {
 return createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}
export function encodeVideoCursor(value:VideoCursor):string {
 return Buffer.from(JSON.stringify({v:1,publishedAt:cursorTimestamp(value.publishedAt),pk:cursorPk(value.pk),maxPk:cursorPk(value.maxPk),anchor:value.anchor,filters:value.filters,vocabulary:value.vocabulary})).toString('base64url');
}
export function decodeVideoCursor(value:unknown,now:Date,filters:string):VideoCursor {
 if(typeof value!=='string'||value.length>VIDEO_CURSOR_MAX_LENGTH||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))return fail();
 let raw:unknown;try{raw=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return fail();}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
 const r=raw as Record<string,unknown>;
 if(r.v!==1||typeof r.anchor!=='string'||typeof r.filters!=='string'||!/^[a-f0-9]{64}$/.test(r.filters)||!(r.vocabulary===null||typeof r.vocabulary==='string'&&r.vocabulary.length>0&&r.vocabulary.length<=100))return fail();
 const anchor=Date.parse(r.anchor);
 if(!Number.isFinite(anchor)||new Date(anchor).toISOString()!==r.anchor||anchor>+now||+now-anchor>VIDEO_CURSOR_MAX_AGE_MS||r.filters!==filters)return fail();
 const cursor:VideoCursor={v:1,publishedAt:cursorTimestamp(r.publishedAt),pk:cursorPk(r.pk),maxPk:cursorPk(r.maxPk),anchor:r.anchor,filters:r.filters,vocabulary:r.vocabulary};
 if(BigInt(cursor.pk)>BigInt(cursor.maxPk)||encodeVideoCursor(cursor)!==value)return fail();
 return cursor;
}
