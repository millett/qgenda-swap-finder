const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(today = '2026-11-09T12:00:00') {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [today])); }
    static now() { return new Date(today).getTime(); }
  }
  const context = vm.createContext({ Date: FixedDate, window: {}, getFriends: () => ({ friends: ['Friend'] }) });
  vm.runInContext(fs.readFileSync('js/swap-finder.js', 'utf8'), context);
  return context;
}
const entry = (date, shift = 'CA GOR', name = 'Me') => ({ date, shift, name });

test('unknown dates never inflate days off; range has exactly seven days', () => {
  const app = load();
  const result = app.getScheduleSummary([entry('2026-11-09'), entry('2026-11-11')], 'Me', 7);
  assert.equal(result.stats.days_off, 1);
  assert.equal(result.stats.unknown_days, 4);
  assert.equal(result.stats.total_day_shifts, 2);
  assert.equal(result.coverage_warning.kind, 'after_end');
  assert.equal(result.weekly_breakdown[0].off_days, 1);
});

test('fully missing schedule is unknown, not a week off', () => {
  const result = load().getScheduleSummary([], 'Me', 7);
  assert.equal(result.stats.days_off, 0);
  assert.equal(result.stats.unknown_days, 7);
});

test('Sunday belongs to the preceding Monday week', () => {
  const result = load('2026-11-15T12:00:00').getScheduleSummary([
    entry('2026-11-15', 'CA Senior Day Call'), entry('2026-11-22')
  ], 'Me', 7);
  assert.equal(result.weekly_breakdown[0].week_of, '11/09');
  assert.equal(result.weekly_breakdown[0].calls, 1);
  assert.equal(result.upcoming_shifts.length, 1);
});

test('post-call tags follow in-house nights, not routine day or home call', () => {
  for (const shift of ['CA Senior Day Call', 'CA COMER Call', 'CA Senior Night Call']) {
    const result = load().getScheduleSummary([
      entry('2026-11-09', shift), entry('2026-11-10')
    ], 'Me', 2);
    assert.equal(result.upcoming_shifts[1].tags.includes('Post-call'), shift === 'CA Senior Night Call');
  }
});

test('Friday night and explicit post-call weekends are not golden for anyone', () => {
  const fixtures = [entry('2026-11-09'), entry('2026-11-16'),
    entry('2026-11-09', 'CA GOR', 'Friend'), entry('2026-11-16', 'CA GOR', 'Friend')];
  for (const [date, shift] of [['2026-11-13', 'CA Senior Night Call'], ['2026-11-14', 'CA Post Call'], ['2026-11-15', 'CA ICU 3 Elective'], ['2026-11-14', 'Unmapped clinical assignment']]) {
    const result = load().findGoldenWeekends([...fixtures, entry(date, shift), entry(date, shift, 'Friend')], 'Me', 1)[0];
    assert.equal(result.i_am_off, false, shift);
    assert.equal(result.friends_off.length, 0, shift);
  }
});

test('known free or vacation weekends remain golden; home call does not imply post-call', () => {
  const fixtures = [entry('2026-11-09'), entry('2026-11-16')];
  for (const extra of [[], [entry('2026-11-14', 'CA Vacation')], [entry('2026-11-13', 'CA COMER Call')]]) {
    assert.equal(load().findGoldenWeekends([...fixtures, ...extra], 'Me', 1)[0].i_am_off, true);
  }
});

test('Friday coverage is required before calling a weekend golden', () => {
  const result = load().findGoldenWeekends([entry('2026-11-14', 'CA Vacation'), entry('2026-11-16')], 'Me', 1)[0];
  assert.equal(result.i_am_off, false);
  assert.equal(result.self_coverage_warning.kind, 'before_start');
});
