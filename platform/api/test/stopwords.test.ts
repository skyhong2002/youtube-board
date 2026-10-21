import { it, expect } from 'vitest';
import { stopwordSet, LEGACY_DISPLAY_STOPWORDS, SITE_DISPLAY_STOPWORDS } from '../src/reports/stopwords.js';

it('matches exclusions without ASCII case and drops calendar numbers, keeping longer numbers and topics',()=>{
 const stop=stopwordSet([...LEGACY_DISPLAY_STOPWORDS,...SITE_DISPLAY_STOPWORDS]);
 for(const term of ['LINE','Line','line','ig','Threads','LIVE','訂閱','2026','2026年','20','10月','3日','2019年'])expect(stop.has(term),term).toBe(true);
 for(const term of ['228','1450','921','颱風','蔣萬安','AI','Lin'])expect(stop.has(term),term).toBe(false);
});
