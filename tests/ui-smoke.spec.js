const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(__dirname, '..', 'index.html')}`;

async function openApp(page) {
  await page.addInitScript(() => {
    localStorage.setItem('qgenda_my_name', 'Millett, Matthew');
    localStorage.removeItem('qgenda_active_tab');
  });
  await page.goto(fileUrl);
  await expect(page.locator('#schedule-info')).not.toHaveText('...', { timeout: 10000 });
}

async function getTripFixture(page) {
  return page.evaluate(() => {
    const currentName = localStorage.getItem('qgenda_my_name');
    const postCallMarkers = new Set(['CA Post Call', 'CA Home Post Call']);
    const blockingShift = SCHEDULE
      .filter(s =>
        s.name === currentName &&
        s.shift &&
        s.shift.startsWith('CA ') &&
        !postCallMarkers.has(s.shift) &&
        (CALL_SHIFTS.has(s.shift) || DAY_SHIFTS.has(s.shift) || ICU_SHIFTS.has(s.shift))
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    if (!blockingShift) {
      throw new Error('No blocking Matthew shift found in generated schedule');
    }

    return {
      date: blockingShift.date,
      displayShift: blockingShift.shift.replace('CA ', ''),
    };
  });
}

async function getScheduleFixtureDate(page) {
  return page.evaluate(() => {
    const dates = SCHEDULE
      .map(s => s.date)
      .filter(Boolean)
      .sort();

    if (dates.length === 0) {
      throw new Error('Generated schedule has no dated entries');
    }

    return dates[0];
  });
}

test.describe('QGenda UI smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T12:00:00-06:00'));
  });
  test('QGenda name changes preserve user-scoped friends and ledger data', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('qgenda_my_name', 'Millett (2)');
      localStorage.setItem('qgenda_friends_Millett__2_', JSON.stringify({
        friends: ['Kubiak (1)'],
        notes: { 'Kubiak (1)': 'Reliable swap partner' },
        prefers_nights: ['Kubiak (1)'],
        good_samaritans: [],
      }));
      localStorage.setItem('qgenda_ledger_Millett__2_', JSON.stringify({
        debts: [{ person: 'Ackerman (2)', direction: 'owe_you', shift: 'Call', date: '2026-07-01' }],
      }));
    });

    await page.goto(fileUrl);
    await expect(page.locator('#my-name-select')).toHaveValue('Millett, Matthew');

    const migrated = await page.evaluate(() => ({
      friends: JSON.parse(localStorage.getItem('qgenda_friends_Millett__Matthew')),
      ledger: JSON.parse(localStorage.getItem('qgenda_ledger_Millett__Matthew')),
    }));

    expect(migrated.friends.friends).toEqual(['Kubiak, Rachel']);
    expect(migrated.friends.notes['Kubiak, Rachel']).toBe('Reliable swap partner');
    expect(migrated.ledger.debts[0].person).toBe('Ackerman, Max');
  });

  test('First launch asks the resident to pick their name', async ({ page }) => {
    await page.goto(fileUrl);
    await expect(page.locator('#schedule-info')).not.toHaveText('...', { timeout: 10000 });
    await expect(page.locator('#my-name-select')).toHaveValue('');
    await expect(page.locator('#upcoming-shifts')).toContainText('Select your name');
  });

  test('My Schedule defaults to calendar and supports day details, navigation, and list', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.schedule-calendar')).toBeVisible();
    await page.locator('[data-date="2026-11-27"]').click();
    await expect(page.locator('.calendar-detail')).toContainText('Post-call if worked past 11 p.m.');
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
    await expect(page.locator('.calendar-toolbar h3')).toHaveText('December 2026');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.locator('#upcoming-shifts table')).toBeVisible();
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('.schedule-calendar').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('#next-call-date')).not.toHaveText('-');
  });

  test('Golden Weekends search populates results', async ({ page }) => {
    await openApp(page);
    await page.click('[role="tab"][data-tab="golden-weekends"]');
    await page.click('#btn-golden-search');

    const results = page.locator('#golden-results');
    await expect(results).not.toHaveText('', { timeout: 10000 });
    const hasCard = await page.locator('#golden-results .golden-card').count();
    const hasNoData = await page.locator('#golden-results .no-data').count();
    expect(hasCard + hasNoData).toBeGreaterThan(0);
  });

  test('Trip Planner shows in-range blocking shifts and swaps', async ({ page }) => {
    await openApp(page);
    const fixture = await getTripFixture(page);
    await page.click('[role="tab"][data-tab="trip-planner"]');

    await page.fill('#trip-start', fixture.date);
    await page.fill('#trip-end', fixture.date);
    await page.click('#btn-trip-search');

    const tripShifts = page.locator('#trip-shifts');
    await expect(tripShifts).not.toHaveText('', { timeout: 10000 });
    await expect(tripShifts).toContainText(fixture.displayShift);

    const tripSwaps = page.locator('#trip-swaps');
    await expect(tripSwaps).not.toHaveText('', { timeout: 10000 });
  });

  test('Weekend Swap returns candidates', async ({ page }) => {
    await openApp(page);
    await page.click('[role="tab"][data-tab="weekend-swap"]');

    const weekendValue = await page.evaluate(() => {
      const select = document.getElementById('weekend-select');
      if (!select) return '';
      const opt = Array.from(select.options).find(o => o.value !== '');
      return opt ? opt.value : '';
    });

    expect(weekendValue).not.toBe('');
    await page.selectOption('#weekend-select', weekendValue);
    await page.click('#btn-weekend-search');

    const results = page.locator('#weekend-results');
    await expect(results).not.toHaveText('', { timeout: 10000 });

    const hasCards = await page.locator('#weekend-results .swap-card').count();
    const hasNoData = await page.locator('#weekend-results .no-data').count();
    expect(hasCards + hasNoData).toBeGreaterThan(0);
  });

  test('Holiday Swap finds resident coverage for assigned holidays', async ({ page }) => {
    await openApp(page);
    await page.click('[role="tab"][data-tab="holiday-swap"]');

    const fixture = await page.evaluate(() => getHolidayAssignmentOptions().find(h => h.hasWorkShift));
    expect(fixture).toBeTruthy();
    await page.selectOption('#holiday-select', fixture.date);
    await page.click('#btn-holiday-search');
    await expect(page.locator('#my-holiday-info')).toContainText(fixture.label);
    await expect(page.locator('#my-holiday-info')).toContainText(fixture.status);
    await expect(page.locator('#holiday-results .swap-card').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#holiday-results')).not.toContainText('CRNA');
  });

  test('Weekend Swap hidden candidates can be shown again and reset', async ({ page }) => {
    await openApp(page);
    await page.click('[role="tab"][data-tab="weekend-swap"]');

    const weekendValue = await page.evaluate(() => {
      const select = document.getElementById('weekend-select');
      if (!select) return '';
      const opt = Array.from(select.options).find(o => o.value !== '');
      return opt ? opt.value : '';
    });

    expect(weekendValue).not.toBe('');
    await page.selectOption('#weekend-select', weekendValue);
    await page.click('#btn-weekend-search');

    const firstCard = page.locator('#weekend-results .swap-card').first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });

    const candidateName = ((await firstCard.locator('.candidate-name').first().textContent()) || '').trim();
    expect(candidateName).not.toBe('');

    await firstCard.locator('.hide-candidate-btn').click();

    const hiddenBanner = page.locator('#weekend-results .hidden-candidates-banner');
    await expect(hiddenBanner).toContainText('Hidden candidates');
    await hiddenBanner.getByRole('button', { name: 'Show hidden people' }).click();

    const restoredCard = page.locator('#weekend-results .swap-card').filter({ hasText: candidateName }).first();
    await expect(restoredCard).toBeVisible();
    await expect(restoredCard.getByRole('button', { name: 'Unhide' })).toBeVisible();

    await hiddenBanner.getByRole('button', { name: 'Reset hidden list' }).click();

    await expect(page.locator('#weekend-results .hidden-candidates-banner')).toHaveCount(0);
    const resetCard = page.locator('#weekend-results .swap-card').filter({ hasText: candidateName }).first();
    await expect(resetCard).toBeVisible();
    await expect(resetCard.getByRole('button', { name: 'Hide' })).toBeVisible();
  });

  test('Who\'s Free returns results', async ({ page }) => {
    await openApp(page);
    const fixtureDate = await getScheduleFixtureDate(page);
    await page.click('[role="tab"][data-tab="whos-free"]');
    await page.fill('#free-date', fixtureDate);
    await page.click('#btn-free-check');

    const results = page.locator('#free-results');
    await expect(results).not.toHaveText('', { timeout: 10000 });

    const hasRows = await page.locator('#free-results .free-resident').count();
    const hasNoData = await page.locator('#free-results .no-data').count();
    expect(hasRows + hasNoData).toBeGreaterThan(0);
  });
});
