import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScheduleRecord,
  scheduleEveryLabel,
  scheduleTimingFromDraft,
} from '../src/features/schedule-api.js';

test('scheduleEveryLabel formats seconds into minutes / hours / days', () => {
  assert.equal(scheduleEveryLabel(0), '周期');
  assert.equal(scheduleEveryLabel(1800), '每 30 分钟');
  assert.equal(scheduleEveryLabel(7200), '每 2 小时');
  assert.equal(scheduleEveryLabel(86400), '每 1 天');
});

test('scheduleTimingFromDraft builds daily, weekdays, once, and cron timing objects', () => {
  const daily = scheduleTimingFromDraft({ freq: 'daily', time: '09:15' });
  assert.equal(daily.kind, 'daily');
  assert.equal(daily.daily.time, '09:15');

  const weekdays = scheduleTimingFromDraft({ freq: 'weekdays', time: '08:30' });
  assert.equal(weekdays.kind, 'weekly');
  assert.deepEqual(weekdays.weekly.weekdays, [1, 2, 3, 4, 5]);

  const cron = scheduleTimingFromDraft({ advanced: true, cron: '0 9 * * 1-5' });
  assert.equal(cron.kind, 'cron');
  assert.equal(cron.cron.expression, '0 9 * * 1-5');
});

test('normalizeScheduleRecord preserves core fields', () => {
  const rec = normalizeScheduleRecord({
    id: 'sch_1',
    title: '晨报',
    enabled: true,
    every: { kind: 'daily', time: '08:00' },
  });
  assert.equal(rec.id, 'sch_1');
  assert.equal(rec.title, '晨报');
  assert.equal(rec.enabled, true);
});
