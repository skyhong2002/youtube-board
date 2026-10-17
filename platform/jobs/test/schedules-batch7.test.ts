import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { scheduleSlot } from '@youtube-board/notifications';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { workflowBatch } from '../../shared/worker-batches.js';

// Batch 7 (Telegram, last) of the Laravel scheduler handoff (docs/laravel-scheduler-handoff-2026-10-18.md).
// Laravel routes/console.php evaluates both digests every minute and claims a durable TelegramScheduleSlotGate slot:
//   hourly: 10-minute slots on the UTC (app.timezone) clock, all day;
//   daily:  30-minute Asia/Taipei slots, ->between('9:00','21:00'). between() compares the schedule:run start instant
//           (with seconds) to 21:00:00, so the 21:00 slot never fires in practice: 24 slots 09:00–20:30.
// The TS cron produces the first minute of each of those slots; the runner re-derives and claims the same slot key.
const path = fileURLToPath(new URL('../../runtime/schedules.batch7.json', import.meta.url));
const taipei = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+08:00`));
const day = (config: Awaited<ReturnType<typeof readScheduleConfig>>) => {
  const runs: { schedule: string; at: Date }[] = [];
  for (let minute = 0; minute < 1440; minute++) {
    const at = new Date(taipei('2031-03-04', '00:00').getTime() + minute * 60000);
    for (const run of planSchedules(config, at, 1)) runs.push({ schedule: run.schedule, at: new Date(run.scheduledAt) });
  }
  return runs;
};

describe('batch 7 Telegram digest schedule file', () => {
  it('passes the real validator with exactly the two Telegram workflows, no options, windows or force', async () => {
    const config = await readScheduleConfig(path);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.schedules.map(s => [s.id, s.workflow, s.cron])).toEqual([
      ['batch7-telegram-hourly-v1', 'notify.telegram.hourly', '*/10 * * * *'],
      ['batch7-telegram-daily-v1', 'notify.telegram.daily', '0,30 9-20 * * *'],
    ]);
    for (const s of config.schedules) { expect(s.options).toEqual({}); expect(s.window).toBeUndefined(); expect(workflowBatch(s.workflow)).toBe('telegram'); }
    // --force is a manual-only, separately gated bypass and can never recur.
    expect(() => validateScheduleConfig({ ...config, schedules: [{ ...config.schedules[0]!, options: { force: true } }] })).toThrow('Operator-only');
  });

  it('renders the Laravel command equivalents (always with AI, never forced)', async () => {
    const config = await readScheduleConfig(path);
    expect(config.schedules.map(s => workflowArgs(s.workflow, { options: s.options }).join(' '))).toEqual(['notify:telegram:hourly --execute', 'notify:telegram:daily --execute']);
  });

  it('enqueues one run per Laravel slot: 144 UTC ten-minute hourly slots and 24 Taipei daily slots 09:00–20:30', async () => {
    const runs = day(await readScheduleConfig(path));
    const hourly = runs.filter(r => r.schedule === 'batch7-telegram-hourly-v1'), daily = runs.filter(r => r.schedule === 'batch7-telegram-daily-v1');
    expect(hourly).toHaveLength(144); expect(daily).toHaveLength(24);
    const hourlyKeys = hourly.map(r => scheduleSlot('hourly', r.at)?.key);
    expect(new Set(hourlyKeys).size).toBe(144);
    // Laravel slot key: tg:schedule:hourly:{UTC Ymd}:{floor((H*60+i)/10)} — Taipei 08:00 is UTC 00:00 slot 0.
    expect(scheduleSlot('hourly', taipei('2031-03-04', '08:00'))?.key).toBe('tg:schedule:hourly:20310304:0');
    expect(scheduleSlot('hourly', taipei('2031-03-04', '07:50'))?.key).toBe('tg:schedule:hourly:20310303:143');
    const dailyKeys = daily.map(r => scheduleSlot('daily', r.at)?.key);
    expect(dailyKeys).toEqual(Array.from({ length: 24 }, (_, i) => `tg:schedule:daily:20310304:${18 + i}`));
    const times = daily.map(r => new Date(r.at.getTime() + 8 * 3600000).toISOString().slice(11, 16));
    expect(times[0]).toBe('09:00'); expect(times.at(-1)).toBe('20:30');
    for (const t of ['08:30', '21:00', '21:30']) expect(times).not.toContain(t);
    // The runner itself refuses daily execution outside Laravel's effective window.
    expect(scheduleSlot('daily', taipei('2031-03-04', '21:00'))).toBeNull();
    expect(scheduleSlot('daily', taipei('2031-03-04', '08:59'))).toBeNull();
  });
});
