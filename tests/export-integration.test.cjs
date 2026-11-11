const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app() {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-10T12:00:00-06:00'])); }
  }
  const context = vm.createContext({
    Date: FixedDate, window: {}, document: { addEventListener() {} },
    localStorage: { getItem(key) { return key === 'qgenda_my_name' ? 'Millett, Matthew' : null; }, setItem() {} }
  });
  for (const file of ['schedule', 'swap-finder', 'app']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), context);
  return context;
}

test('current export contains unique records and no unmapped resident shifts', () => {
  const context = app();
  const result = vm.runInContext(`({ count: SCHEDULE.length, unique: new Set(SCHEDULE.map(s => JSON.stringify(s))).size,
    start: SCHEDULE[0].date, end: SCHEDULE[SCHEDULE.length-1].date, metadata: SCHEDULE_METADATA,
    unknown: getUnknownCaShiftCounts(), matt: PERSON_TYPES_DATA['Millett, Matthew'] })`, context);
  assert.equal(result.count, result.unique);
  assert.equal(result.count, result.metadata.recordCount);
  assert.equal(result.start, result.metadata.dateStart);
  assert.equal(result.end, result.metadata.dateEnd);
  assert.equal(result.start, '2026-11-09');
  assert.equal(result.end, '2027-06-30');
  assert.equal(Object.keys(result.unknown).length, 0);
  assert.equal(context.getPersonType('Millett, Matthew', '2027-06-01'), 'ca3');
});

test('main searches run against the new export and preserve coverage and eligibility', () => {
  const context = app();
  const result = vm.runInContext(`(() => {
    const me = 'Millett, Matthew';
    const summary = getScheduleSummary(SCHEDULE, me, 90);
    const golden = findGoldenWeekends(SCHEDULE, me, 24);
    const trip = findTripCoverage(SCHEDULE, me, '2026-11-20', '2026-11-24');
    const coverage = findCoverageCandidates(SCHEDULE, me, ['2026-11-20']);
    const holiday = findHolidaySwapCandidates(SCHEDULE, me, '2026-11-26');
    const workWeekend = SCHEDULE.find(s => s.name === me && parseDate(s.date).getDay() === 6 && CALL_SHIFTS.has(s.shift));
    const saturday = parseDate(workWeekend.date);
    const weekend = findWeekendSwap(SCHEDULE, me, [saturday, addDays(saturday, 1)], 2, 2);
    return { shifts: summary.upcoming_shifts.length, golden: golden.length, trip: trip.blocking_shifts.length,
      coverage: coverage.length, holiday: holiday.candidates.length, weekend: weekend.length,
      invalidCoverage: coverage.filter(c => c.free_dates.some(d => getShiftsOnDate(SCHEDULE, c.name, parseDate(d)).length > 0)).length };
  })()`, context);
  assert.ok(result.shifts > 0);
  assert.ok(result.golden > 0);
  assert.ok(result.trip > 0);
  assert.equal(result.invalidCoverage, 0);
});
