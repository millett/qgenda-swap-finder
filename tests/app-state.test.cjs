const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(today = '2026-11-10T12:00:00') {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [today])); }
  }
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', value: '',
      replaceChildren() { this.innerHTML = ''; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    Date: FixedDate,
    window: {},
    document: { getElementById, addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  });
  vm.runInContext(fs.readFileSync('js/swap-finder.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), context);
  return { context, getElementById };
}

test('invalid trip clears previous results instead of declaring dates free', () => {
  const { context, getElementById: el } = load();
  vm.runInContext("MY_NAME = 'Me'", context);
  ['trip-eligibility', 'trip-packages', 'trip-candidates', 'trip-swaps'].forEach(id => el(id).innerHTML = 'old results');
  context.renderTripPlanner('2026-11-20', '2026-11-19', false, false, false);
  assert.match(el('trip-shifts').innerHTML, /end date on or after/);
  for (const id of ['trip-eligibility', 'trip-packages', 'trip-candidates', 'trip-swaps']) assert.equal(el(id).innerHTML, '');
});

test('trip and golden weekends require a selected resident', () => {
  const { context, getElementById: el } = load();
  context.renderTripPlanner('2026-11-20', '2026-11-21', false, false, false);
  context.renderGoldenWeekends(4, true);
  assert.match(el('trip-shifts').innerHTML, /Select your name/);
  assert.match(el('golden-results').innerHTML, /Select your name/);
});

test('switching residents clears hidden tabs, generated messages, and cached candidates', () => {
  const { context, getElementById: el } = load();
  const refreshed = [];
  for (const fn of ['renderMySchedule', 'populateWeekendDropdown', 'populateHolidayDropdown', 'syncRotationOverridesUI', 'renderFriendsList', 'renderLedger']) {
    context[fn] = () => refreshed.push(fn);
  }
  const resultIds = ['golden-results', 'weekend-results', 'my-weekend-info', 'holiday-results', 'my-holiday-info', 'trip-eligibility', 'trip-shifts', 'trip-packages', 'trip-candidates', 'trip-swaps', 'free-results'];
  resultIds.forEach(id => el(id).innerHTML = 'previous resident');
  el('swap-message').value = 'old draft';
  el('holiday-message').value = 'old draft';
  context.window.lastWeekendSearch = { weekend: 'old weekend' };
  context.window.currentHolidaySwaps = [{ name: 'old candidate' }];
  context.refreshCurrentTab();
  resultIds.forEach(id => assert.equal(el(id).innerHTML, '', id));
  assert.equal(el('swap-message').value, '');
  assert.equal(el('holiday-message').value, '');
  assert.equal(context.window.lastWeekendSearch, undefined);
  assert.equal(context.window.currentHolidaySwaps, undefined);
  assert.equal(refreshed.length, 6);
});

test('availability excludes prior-night call and unknown work, but ignores request markers', () => {
  const { context, getElementById: el } = load();
  const names = ['Overnight', 'Unknown work', 'Request only', 'Day call yesterday', 'Outside export'];
  context.SCHEDULE = names.flatMap(name => [
    { name, date: '2026-11-09', shift: 'CA GOR' },
    { name, date: '2026-11-13', shift: 'CA GOR' }
  ]);
  context.SCHEDULE.push(
    { name: 'Overnight', date: '2026-11-10', shift: 'CA Senior Night Call' },
    { name: 'Unknown work', date: '2026-11-11', shift: 'New assignment' },
    { name: 'Request only', date: '2026-11-11', shift: 'CA Call Req' },
    { name: 'Day call yesterday', date: '2026-11-10', shift: 'CA Senior Day Call' }
  );
  context.SCHEDULE = context.SCHEDULE.filter(s => s.name !== 'Outside export');
  context.getAllResidents = () => names;
  context.isResident = () => true;
  context.getPersonType = () => 'ca3';
  context.renderWhosFree('2026-11-11', false, false);
  const html = el('free-results').innerHTML;
  assert.doesNotMatch(html, /<strong>Overnight<\/strong>/);
  assert.doesNotMatch(html, /<strong>Unknown work<\/strong>/);
  assert.match(html, /<strong>Request only<\/strong>: OFF/);
  assert.match(html, /<strong>Day call yesterday<\/strong>: OFF/);
  assert.doesNotMatch(html, /<strong>Outside export<\/strong>: OFF/);
});


test('resident seniority and senior-call eligibility survive January 1', () => {
  const { context } = load();
  context.PERSON_TYPES_DATA = { 'Me': 'ca2', 'Junior': 'ca1', 'Incoming': 'preintern' };
  assert.equal(context.getPersonType('Me', '2026-06-30'), 'ca2');
  for (const date of ['2026-07-01', '2026-12-31', '2027-01-01', '2027-06-30']) {
    assert.equal(context.getPersonType('Me', date), 'ca3', date);
    assert.equal(context.canCoverShift('Me', 'CA Senior Night Call', date), true, date);
    assert.equal(context.getPersonType('Junior', date), 'ca2', date);
    assert.equal(context.canCoverShift('Junior', 'CA Senior Night Call', date), false, date);
    assert.equal(context.canCoverShift('Incoming', 'CA Senior Day Call', date), false, date);
  }
});

test('exports with current year levels do not get promoted twice', () => {
  const { context } = load();
  context.SCHEDULE_METADATA = { personTypePromotionDate: null };
  context.PERSON_TYPES_DATA = { Junior: 'ca2' };
  assert.equal(context.getPersonType('Junior', '2027-01-01'), 'ca2');
  assert.equal(context.canCoverShift('Junior', 'CA Senior Night Call', '2027-01-01'), false);
});

test('trip coverage checks all assignments and overnight recovery, including CRNAs', () => {
  const { context } = load();
  const names = ['Me', 'Senior free', 'Junior free', 'CRNA busy', 'Tomorrow busy'];
  const schedule = names.flatMap(name => [
    { name, date: '2026-11-09', shift: 'CA GOR' },
    { name, date: '2026-11-15', shift: 'CA GOR' }
  ]);
  schedule.push(
    { name: 'Me', date: '2026-11-11', shift: 'CA GOR' },
    { name: 'Me', date: '2026-11-11', shift: 'CA Senior Night Call' },
    { name: 'CRNA busy', date: '2026-11-11', shift: 'CRNA 7-7' },
    { name: 'Tomorrow busy', date: '2026-11-12', shift: 'CA GOR' }
  );
  context.getPersonType = name => name === 'Junior free' ? 'ca2' : name === 'CRNA busy' ? 'crna' : 'ca3';
  context.getFriends = () => ({ friends: [] });
  const candidates = context.findCoverageCandidates(schedule, 'Me', ['2026-11-11']);
  assert.deepEqual(Array.from(candidates, c => c.name), ['Senior free']);
});


test('calendar groups assignments, aligns Mondays, and retains notes in the list', () => {
  const { context, getElementById: el } = load();
  context.SCHEDULE = [
    {name:'Me', date:'2026-11-09', shift:'CA GOR'},
    {name:'Me', date:'2026-11-26', shift:'CA COMER Call'},
    {name:'Me', date:'2027-02-01', shift:'CA GOR'}
  ];
  vm.runInContext("MY_NAME = 'Me'", context);
  context.renderScheduleView(90);
  let html = el('upcoming-shifts').innerHTML;
  assert.match(html, /November 2026/);
  assert.ok(html.indexOf('Monday, October 26, 2026') < html.indexOf('Sunday, November 1, 2026'));
  assert.match(html, /data-date="2026-11-27"[^>]*Post-call if worked past 11 p.m./);
  assert.match(html, /aria-current="date"/);
  vm.runInContext("scheduleMonth = new Date(2027, 0, 1)", context);
  context.renderScheduleView(90);
  assert.match(el('upcoming-shifts').innerHTML, /January 2027/);
  context.renderScheduleView(7);
  assert.match(el('upcoming-shifts').innerHTML, /November 2026/);
  assert.doesNotMatch(el('upcoming-shifts').innerHTML, /data-date="2026-11-17"/);
  vm.runInContext("scheduleView = 'list'", context);
  context.renderScheduleView(30);
  html = el('upcoming-shifts').innerHTML;
  assert.match(html, /<table>/);
  assert.match(html, /Post-call if worked past 11 p.m./);
});
