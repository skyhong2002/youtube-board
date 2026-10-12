import {it,expect} from 'vitest';
import {planVocabularyBackfill} from '../src/vocabulary-plan.js';
import {planSchedules,validateScheduleConfig} from '../src/scheduler.js';
import {validateWorkflowInput} from '../src/workflow-registry.js';
it('daily schedules produce the previous Taipei day as an exclusive one-day UTC window',()=>{
 const config=validateScheduleConfig({version:1,timezone:'Asia/Taipei',schedules:[{id:'tag-daily',workflow:'tags.vocabulary.sync',cron:'17 3 * * *',window:'previous-day',options:{'max-pages':20}}]});
 const [run]=planSchedules(config,new Date('2026-10-12T19:17:00Z'),1);expect(run?.input.options).toEqual({'max-pages':20,since:'2026-10-11T16:00:00.000Z',until:'2026-10-12T16:00:00.000Z'});
 expect(planSchedules(config,new Date('2026-10-12T19:17:00Z'),1)[0]?.runId).toBe(run?.runId);
 for(const window of [undefined,'previous-hour','yesterday-date'])expect(()=>validateScheduleConfig({...config,schedules:[{...config.schedules[0],window}]})).toThrow('previous-day');
 expect(()=>validateScheduleConfig({...config,schedules:[{...config.schedules[0],options:{since:'2026-10-01T00:00:00Z'}}]})).toThrow('previous-day');
 expect(()=>validateWorkflowInput('tags.vocabulary.sync',{options:{since:'2026-10-01T00:00:00Z',until:'2026-10-02T00:00:00Z','api-key':'secret'}})).toThrow('option');
});
it('offline backfill splits at Taipei midnight with stable IDs, page caps and minute batch cooldowns',()=>{
 const window={since:'2026-10-10T12:00:00Z',until:'2026-10-12T18:00:00Z'},plan=planVocabularyBackfill('backfill-20261012',window);
 expect(plan).toMatchObject({mode:'dry-run',externalCalls:0,writes:0,betweenBatchesMs:60000,resumeIncompleteBeforeNextWindow:true});expect(plan.runs).toHaveLength(4);
 expect(plan.runs[0]?.window).toEqual({since:'2026-10-10T12:00:00.000Z',until:'2026-10-10T16:00:00.000Z'});expect(plan.runs.at(-1)?.window.until).toBe('2026-10-12T18:00:00.000Z');
 expect(plan.runs.every(r=>r.maxPages===20&&Date.parse(r.window.until)-Date.parse(r.window.since)<=86400000)).toBe(true);expect(new Set(plan.runs.map(r=>r.id)).size).toBe(4);expect(planVocabularyBackfill('backfill-20261012',window)).toEqual(plan);
 for(const pages of [0,21,1.5])expect(()=>planVocabularyBackfill('run',window,pages)).toThrow('pages');
 expect(()=>planVocabularyBackfill('tag-foreign',window)).toThrow('id');expect(()=>planVocabularyBackfill('run',{since:'2026-01-01T00:00:00',until:'2026-01-02T00:00:00Z'})).toThrow('timezone');
 expect(()=>planVocabularyBackfill('run',{since:'2024-01-01T00:00:00Z',until:'2026-01-02T00:00:00Z'})).toThrow('366');
});
