// app.js - Main UI logic for QGenda Swap Finder

// User name - can be changed via UI
let MY_NAME = localStorage.getItem('qgenda_my_name') || "Millett, Matthew";

// Person types are now loaded from PERSON_TYPES_DATA in schedule.js (extracted from Excel colors)
// Fallback classification for people not in the color data

/**
 * Get all person types, using color data from Excel if available
 * @returns {Object} Map of name -> type (ca1, ca2, ca3, fellow, crna, faculty, resident, unknown)
 */
function getPersonTypes() {
    // Use pre-computed data from schedule.js if available
    if (typeof PERSON_TYPES_DATA !== 'undefined') {
        return PERSON_TYPES_DATA;
    }

    // Fallback: classify by shift prefix
    const types = {};
    const shiftsByPerson = {};

    SCHEDULE.forEach(s => {
        if (!s.name || !s.shift) return;
        if (!shiftsByPerson[s.name]) {
            shiftsByPerson[s.name] = new Set();
        }
        shiftsByPerson[s.name].add(s.shift);
    });

    for (const [name, shifts] of Object.entries(shiftsByPerson)) {
        const shiftArray = [...shifts];
        const hasCA = shiftArray.some(s => s.startsWith('CA '));
        const hasCRNA = shiftArray.some(s => s.includes('CRNA'));
        const hasFaculty = shiftArray.some(s => s.startsWith('Faculty'));
        const hasFellow = shiftArray.some(s => s.startsWith('Fellow'));

        if (hasCRNA && !hasCA) {
            types[name] = 'crna';
        } else if (hasFaculty) {
            types[name] = 'faculty';
        } else if (hasFellow) {
            types[name] = 'fellow';
        } else if (hasCA) {
            types[name] = 'resident';
        } else {
            types[name] = 'unknown';
        }
    }

    return types;
}

/**
 * Get the type of a person
 * @param {string} name
 * @returns {string} 'ca1' | 'ca2' | 'ca3' | 'fellow' | 'crna' | 'faculty' | 'resident' | 'unknown'
 */
function getPersonType(name) {
    const types = getPersonTypes();
    return types[name] || 'unknown';
}

/**
 * Check if a person is a resident (CA1, CA2, CA3, or generic resident)
 * @param {string} name
 * @returns {boolean}
 */
function isResident(name) {
    const type = getPersonType(name);
    return type === 'intern' || type === 'ca1' || type === 'ca2' || type === 'ca3' || type === 'resident';
}

/**
 * Get a display label for person type
 * @param {string} type
 * @returns {string}
 */
function getTypeLabel(type) {
    const labels = {
        'intern': 'Intern',
        'ca1': 'CA-1',
        'ca2': 'CA-2',
        'ca3': 'CA-3',
        'fellow': 'Fellow',
        'crna': 'CRNA',
        'faculty': 'Faculty',
        'resident': 'Resident',
        'unknown': ''
    };
    return labels[type] || '';
}

/**
 * Get CSS class for person type badge
 * @param {string} type
 * @returns {string}
 */
function getTypeClass(type) {
    const classes = {
        'intern': 'type-intern',
        'ca1': 'type-ca1',
        'ca2': 'type-ca2',
        'ca3': 'type-ca3',
        'fellow': 'type-fellow',
        'crna': 'type-crna',
        'faculty': 'type-faculty',
        'resident': 'type-resident'
    };
    return classes[type] || '';
}

/**
 * Get all unique resident names from the schedule (only actual residents by default)
 * @param {boolean} includeCRNA - Include CRNAs in the list
 * @returns {Array} Sorted array of names
 */
function getAllResidentNames(includeCRNA = false) {
    const names = new Set();
    SCHEDULE.forEach(shift => {
        if (!shift.name) return;
        const ptype = getPersonType(shift.name);
        if (isResident(shift.name)) {
            names.add(shift.name);
        } else if (ptype === 'crna' && includeCRNA) {
            names.add(shift.name);
        } else if (ptype === 'fellow') {
            names.add(shift.name);  // Always include fellows
        }
    });
    return Array.from(names).sort();
}

/**
 * Populate the user selector dropdown based on checkbox state
 */
function populateUserSelector() {
    const select = document.getElementById('my-name-select');
    const showCRNA = document.getElementById('selector-show-crna').checked;
    const allNames = getAllResidentNames(showCRNA);

    // Remember current selection
    const currentValue = select.value || MY_NAME;

    select.innerHTML = allNames.map(name =>
        `<option value="${name}" ${name === currentValue ? 'selected' : ''}>${name}</option>`
    ).join('');

    // If current selection is no longer in list, select first option
    if (!allNames.includes(currentValue) && allNames.length > 0) {
        select.value = allNames[0];
        MY_NAME = allNames[0];
        localStorage.setItem('qgenda_my_name', MY_NAME);
    }
}

/**
 * Initialize the user selector in the header
 */
function initUserSelector() {
    const select = document.getElementById('my-name-select');
    const showCRNACheckbox = document.getElementById('selector-show-crna');

    // Initial populate
    populateUserSelector();

    // Listen for checkbox changes to repopulate dropdown
    showCRNACheckbox.addEventListener('change', populateUserSelector);

    select.addEventListener('change', (e) => {
        MY_NAME = e.target.value;
        localStorage.setItem('qgenda_my_name', MY_NAME);

        // Refresh current tab data
        refreshCurrentTab();
    });
}

/**
 * Refresh the current tab's data after user change
 */
function refreshCurrentTab() {
    const activeTab = localStorage.getItem('qgenda_active_tab') || 'my-schedule';

    switch (activeTab) {
        case 'my-schedule':
            renderMySchedule(parseInt(document.getElementById('schedule-days').value));
            break;
        case 'weekend-swap':
            // Re-populate the weekend dropdown
            populateWeekendDropdown();
            document.getElementById('weekend-results').innerHTML = '';
            document.getElementById('my-weekend-info').innerHTML = '';
            break;
        case 'trip-planner':
            syncRotationOverridesUI();
            break;
        case 'golden-weekends':
            document.getElementById('golden-results').innerHTML = '';
            break;
        case 'friends-list':
            renderFriendsList();
            break;
        case 'swap-ledger':
            renderLedger();
            break;
        // Other tabs will refresh when user interacts
    }
}

/**
 * Populate the weekend dropdown with working weekends
 */
function populateWeekendDropdown() {
    const select = document.getElementById('weekend-select');
    const workingWeekends = getMyWorkingWeekends();
    window.myWorkingWeekends = workingWeekends;

    if (workingWeekends.length === 0) {
        select.innerHTML = '<option value="">No working weekends found</option>';
    } else {
        select.innerHTML = workingWeekends.map((w, idx) => {
            const satStr = formatDateDisplay(w.saturday);
            const sunStr = formatDateDisplay(w.sunday).split(' ')[1];
            const typeIcon = w.type === 'night' ? '🌙' : w.type === 'day' ? '☀️' : '📅';
            const shiftInfo = w.type === 'night' ? 'Call' : w.type === 'day' ? 'Day' : '';
            return `<option value="${idx}">${typeIcon} ${satStr} - ${sunStr} (${shiftInfo})</option>`;
        }).join('');
    }
}

// State Management - User-specific storage
function getUserKey(base) {
    // Create a storage key specific to the current user
    const safeUserName = MY_NAME.replace(/[^a-zA-Z0-9]/g, '_');
    return `${base}_${safeUserName}`;
}

function getHiddenCandidates(key) {
    const data = localStorage.getItem(getUserKey(key));
    if (!data) return new Set();
    try {
        const parsed = JSON.parse(data);
        return new Set(parsed);
    } catch {
        return new Set();
    }
}

function saveHiddenCandidates(key, set) {
    localStorage.setItem(getUserKey(key), JSON.stringify([...set]));
}

function toggleHiddenCandidate(featureKey, name, hide) {
    const key = featureKey === 'weekend' ? 'qgenda_hidden_weekend' : 'qgenda_hidden_trip';
    const hidden = getHiddenCandidates(key);
    if (hide) {
        hidden.add(name);
    } else {
        hidden.delete(name);
    }
    saveHiddenCandidates(key, hidden);

    if (featureKey === 'weekend' && window.lastWeekendSearch) {
        const p = window.lastWeekendSearch;
        renderWeekendSwap(p.weekend, p.weeksToSearch, p.friendsOnly, p.showCRNA, p.showFaculty);
    } else if (featureKey === 'trip') {
        const startDate = document.getElementById('trip-start').value;
        const endDate = document.getElementById('trip-end').value;
        if (startDate && endDate) {
            renderTripPlanner(
                startDate,
                endDate,
                document.getElementById('trip-depart-evening').checked,
                document.getElementById('trip-friends-only').checked,
                document.getElementById('trip-show-crna').checked
            );
        }
    }
}

function getFriends() {
    // Try user-specific key first, fall back to legacy key for migration
    let data = localStorage.getItem(getUserKey('qgenda_friends'));
    if (!data) {
        // Check for legacy data and migrate it
        data = localStorage.getItem('qgenda_friends');
        if (data) {
            // Migrate to user-specific storage
            localStorage.setItem(getUserKey('qgenda_friends'), data);
        }
    }
    const parsed = data ? JSON.parse(data) : { friends: [], notes: {}, prefers_nights: [], good_samaritans: [] };
    // Ensure good_samaritans array exists (migration for old data)
    if (!parsed.good_samaritans) {
        parsed.good_samaritans = [];
    }
    return parsed;
}

function saveFriends(data) {
    localStorage.setItem(getUserKey('qgenda_friends'), JSON.stringify(data));
}

function getLedger() {
    // Try user-specific key first, fall back to legacy key for migration
    let data = localStorage.getItem(getUserKey('qgenda_ledger'));
    if (!data) {
        data = localStorage.getItem('qgenda_ledger');
        if (data) {
            localStorage.setItem(getUserKey('qgenda_ledger'), data);
        }
    }
    return data ? JSON.parse(data) : { debts: [] };
}

function saveLedger(data) {
    localStorage.setItem(getUserKey('qgenda_ledger'), JSON.stringify(data));
}

// Tab Management
function initTabs() {
    const activeTab = localStorage.getItem('qgenda_active_tab') || 'my-schedule';

    document.querySelectorAll('[role="tab"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    switchTab(activeTab);
}

function switchTab(tabId) {
    // Hide all tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all buttons
    document.querySelectorAll('[role="tab"]').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    const selectedTab = document.getElementById(tabId);
    const selectedBtn = document.querySelector(`[data-tab="${tabId}"]`);

    if (selectedTab) selectedTab.classList.add('active');
    if (selectedBtn) selectedBtn.classList.add('active');

    // Save to localStorage
    localStorage.setItem('qgenda_active_tab', tabId);

    if (tabId === 'trip-planner') {
        syncRotationOverridesUI();
    }
}

// Helper Functions
function getAllResidents() {
    const names = new Set();
    SCHEDULE.forEach(shift => {
        if (shift.name && shift.name !== MY_NAME) {
            const ptype = getPersonType(shift.name);
            if (ptype !== 'faculty') {
                names.add(shift.name);
            }
        }
    });
    // Sort: residents first, then CRNAs, then others, alphabetically within each group
    return Array.from(names).sort((a, b) => {
        const typeA = getPersonType(a);
        const typeB = getPersonType(b);
        const order = { 'resident': 0, 'crna': 1, 'unknown': 2 };
        const orderA = order[typeA] ?? 3;
        const orderB = order[typeB] ?? 3;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
    });
}

function filterByFriends(candidates) {
    const friends = getFriends();
    return candidates.filter(c => friends.friends.includes(c.name));
}

function formatLastName(name) {
    if (!name) return '';
    if (name.includes(', ')) {
        return name.split(', ')[0];
    }
    const parts = name.trim().split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : name;
}

function renderTable(containerId, columns, data) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = '<p class="no-data">No data to display</p>';
        return;
    }

    let html = '<table><thead><tr>';
    columns.forEach(col => {
        html += `<th>${col.label}</th>`;
    });
    html += '</tr></thead><tbody>';

    data.forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
            const value = col.render ? col.render(row) : row[col.key];
            html += `<td>${value}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function showLoading(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '<div class="loading">Loading...</div>';
    }
}

function hideLoading(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        const loading = container.querySelector('.loading');
        if (loading) loading.remove();
    }
}

// Data quality: identify CA shifts not mapped to any category
function getUnknownCaShiftCounts() {
    const known = new Set([
        ...CALL_SHIFTS,
        ...DAY_SHIFTS,
        ...ICU_SHIFTS,
        ...UNAVAILABLE_SHIFTS,
    ]);

    const counts = {};
    SCHEDULE.forEach(s => {
        if (!s.shift || !s.shift.startsWith('CA ')) return;
        if (!known.has(s.shift)) {
            counts[s.shift] = (counts[s.shift] || 0) + 1;
        }
    });
    return counts;
}

function renderShiftAudit() {
    const container = document.getElementById('shift-audit');
    if (!container) return;

    const counts = getUnknownCaShiftCounts();
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = '<p class="success-message">✅ No unknown CA shift labels detected.</p>';
        return;
    }

    const list = entries.map(([shift, count]) =>
        `<li><strong>${shift}</strong> <span class="muted">(${count})</span></li>`
    ).join('');

    container.innerHTML = `
        <div class="data-warning-banner">
            <strong>⚠️ Unmapped CA shifts found</strong>
            <p>Add these to the correct category in <code>js/swap-finder.js</code> and update <code>SWAP_RULES.md</code>.</p>
            <ul class="shift-audit-list">${list}</ul>
        </div>
    `;
}

// Rotation completion overrides (CA1/CA2)
function inferRotationCompletion(name) {
    const caSchedule = SCHEDULE.filter(s => s.shift && s.shift.startsWith('CA ') && s.name === name);

    let obDone = false;
    let cardiacDone = false;

    for (const shift of caSchedule) {
        if (shift.shift === 'CA CLI Night Call') {
            const day = getWeekday(parseDate(shift.date));
            if (day === 0 || day === 6) {
                obDone = true;
            }
        }
        if (shift.shift === 'CA GOR4') {
            cardiacDone = true;
        }
        if (obDone && cardiacDone) break;
    }

    return {
        ob_done: obDone,
        cardiac_done: cardiacDone,
        peds_done: false,
        pain_done: false
    };
}

function getRotationOverrides() {
    const key = getUserKey('qgenda_rotation_overrides');
    const inferred = inferRotationCompletion(MY_NAME);
    const stored = localStorage.getItem(key);

    if (!stored) {
        localStorage.setItem(key, JSON.stringify(inferred));
        return inferred;
    }

    try {
        const parsed = JSON.parse(stored);
        return {
            ob_done: parsed.ob_done ?? inferred.ob_done,
            cardiac_done: parsed.cardiac_done ?? inferred.cardiac_done,
            peds_done: parsed.peds_done ?? inferred.peds_done,
            pain_done: parsed.pain_done ?? inferred.pain_done,
        };
    } catch {
        localStorage.setItem(key, JSON.stringify(inferred));
        return inferred;
    }
}

function saveRotationOverrides(data) {
    localStorage.setItem(getUserKey('qgenda_rotation_overrides'), JSON.stringify(data));
}

function syncRotationOverridesUI() {
    const container = document.getElementById('rotation-overrides');
    const fields = document.getElementById('rotation-overrides-fields');
    const note = document.getElementById('rotation-overrides-note');
    if (!container || !fields || !note) return;

    const personType = getPersonType(MY_NAME);
    if (personType === 'ca3' || personType === 'fellow') {
        container.style.display = 'block';
        fields.style.display = 'none';
        note.textContent = 'CA3+ are eligible for vacation during all rotations.';
        return;
    }

    container.style.display = 'block';
    fields.style.display = 'grid';

    const overrides = getRotationOverrides();
    const inferred = inferRotationCompletion(MY_NAME);

    const obBox = document.getElementById('rot-ob-done');
    const cardiacBox = document.getElementById('rot-cardiac-done');
    const pedsBox = document.getElementById('rot-peds-done');
    const painBox = document.getElementById('rot-pain-done');

    if (obBox) obBox.checked = !!overrides.ob_done;
    if (cardiacBox) cardiacBox.checked = !!overrides.cardiac_done;
    if (pedsBox) pedsBox.checked = !!overrides.peds_done;
    if (painBox) painBox.checked = !!overrides.pain_done;

    const hints = [];
    if (inferred.ob_done) hints.push('OB auto-detected (weekend CLI night call)');
    if (inferred.cardiac_done) hints.push('Cardiac auto-detected (GOR4)');
    const legend = 'Legend: OB via weekend CLI night call; Cardiac via GOR4.';
    note.textContent = hints.length > 0 ? `${hints.join(' • ')} • ${legend}` : `${legend} Auto-detected where possible.`;
}

function bindRotationOverrideHandlers() {
    const obBox = document.getElementById('rot-ob-done');
    const cardiacBox = document.getElementById('rot-cardiac-done');
    const pedsBox = document.getElementById('rot-peds-done');
    const painBox = document.getElementById('rot-pain-done');

    const handler = () => {
        const overrides = getRotationOverrides();
        overrides.ob_done = obBox ? obBox.checked : overrides.ob_done;
        overrides.cardiac_done = cardiacBox ? cardiacBox.checked : overrides.cardiac_done;
        overrides.peds_done = pedsBox ? pedsBox.checked : overrides.peds_done;
        overrides.pain_done = painBox ? painBox.checked : overrides.pain_done;
        saveRotationOverrides(overrides);

        const startDate = document.getElementById('trip-start').value;
        const endDate = document.getElementById('trip-end').value;
        if (startDate && endDate) {
            renderTripPlanner(
                startDate,
                endDate,
                document.getElementById('trip-depart-evening').checked,
                document.getElementById('trip-friends-only').checked,
                document.getElementById('trip-show-crna').checked
            );
        }
    };

    [obBox, cardiacBox, pedsBox, painBox].forEach(box => {
        if (box) box.addEventListener('change', handler);
    });
}

function getEffectiveVacationIneligibleShifts(myName, overrides) {
    const personType = getPersonType(myName);
    if (personType === 'ca3' || personType === 'fellow') {
        return new Set();
    }

    const ineligible = new Set(VACATION_INELIGIBLE_SHIFTS);
    const removeGroup = (group) => group.forEach(s => ineligible.delete(s));

    if (overrides?.ob_done) {
        removeGroup(new Set(['CA OB', 'CA OB3']));
    }
    if (overrides?.cardiac_done) {
        removeGroup(new Set(['CA CV Cardiac', 'CA CV-3']));
    }
    if (overrides?.peds_done) {
        removeGroup(new Set(['CA PEDS', 'CA Peds ACT']));
    }
    if (overrides?.pain_done) {
        removeGroup(new Set(['CA Pain Clinic', 'CA Pain Clinic 3']));
    }

    return ineligible;
}

// Vacation eligibility helpers (ineligible rotations)
function getVacationIneligibleDates(schedule, myName, startDate, endDate, ineligibleSet) {
    const caSchedule = schedule.filter(s => s.shift && s.shift.startsWith('CA ') && s.name === myName);
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    const results = [];

    let current = new Date(start);
    while (current <= end) {
        const shiftsOnDay = getShiftsOnDate(caSchedule, myName, current);
        const ineligible = shiftsOnDay.filter(s => ineligibleSet.has(s.shift));
        if (ineligible.length > 0) {
            results.push({
                date: formatDate(current),
                shifts: ineligible.map(s => s.shift)
            });
        }
        current = addDays(current, 1);
    }

    return results;
}

function renderVacationEligibility(startDate, endDate, dataWarning) {
    const container = document.getElementById('trip-eligibility');
    if (!container) return;

    const personType = getPersonType(MY_NAME);
    const overrides = getRotationOverrides();
    const ineligibleSet = getEffectiveVacationIneligibleShifts(MY_NAME, overrides);

    if (personType === 'ca3' || personType === 'fellow') {
        container.innerHTML = `
            <div class="success-message">
                ✅ CA3+ are eligible for vacation during all rotations (no ineligible blocks enforced).
            </div>
        `;
        return;
    }

    const ineligibleDates = getVacationIneligibleDates(SCHEDULE, MY_NAME, startDate, endDate, ineligibleSet);

    if (ineligibleDates.length === 0) {
        const overridesActive = [];
        if (overrides.ob_done) overridesActive.push('OB');
        if (overrides.cardiac_done) overridesActive.push('Cardiac');
        if (overrides.peds_done) overridesActive.push('Peds');
        if (overrides.pain_done) overridesActive.push('Pain');

        const caveat = dataWarning
            ? '<p class="muted">⚠️ Schedule data does not fully cover this date range, so eligibility may be incomplete.</p>'
            : '';
        const overrideNote = overridesActive.length > 0
            ? `<p class="muted">Overrides applied: ${overridesActive.join(', ')}</p>`
            : '';
        container.innerHTML = `
            <div class="success-message">
                ✅ Vacation-eligible based on current schedule data.
                ${overrideNote}
                ${caveat}
            </div>
        `;
        return;
    }

    const rows = ineligibleDates.map(entry => {
        const dateDisplay = formatDateDisplay(parseDate(entry.date));
        const shiftList = entry.shifts.map(s => s.replace('CA ', '')).join(', ');
        return `<li><strong>${dateDisplay}</strong> — ${shiftList}</li>`;
    }).join('');

    const caveat = dataWarning
        ? '<p class="muted">⚠️ Schedule data does not fully cover this date range, so other ineligible days may not be shown.</p>'
        : '';

    container.innerHTML = `
        <div class="data-warning-banner">
            <strong>🚫 Vacation-ineligible rotation during selected dates</strong>
            <ul class="shift-audit-list">${rows}</ul>
            ${caveat}
        </div>
    `;
}

// Tab 1: My Schedule
function initMyScheduleTab() {
    const daysSlider = document.getElementById('schedule-days');
    const daysValue = document.getElementById('days-ahead-value');
    const refreshBtn = document.getElementById('btn-refresh-schedule');

    daysSlider.addEventListener('input', (e) => {
        daysValue.textContent = e.target.value;
    });

    refreshBtn.addEventListener('click', () => {
        const days = parseInt(daysSlider.value);
        renderMySchedule(days);
    });

    // Initial render
    renderMySchedule(30);
}

function renderMySchedule(daysAhead) {
    showLoading('upcoming-shifts');

    const summary = getScheduleSummary(SCHEDULE, MY_NAME, daysAhead);
    const stats = summary.stats;

    // Render metrics
    const nextCallStr = stats.next_call ?
        `${formatDateDisplay(stats.next_call.date)} - ${stats.next_call.shift}` : 'None scheduled';
    document.getElementById('next-call-date').textContent = nextCallStr;
    document.getElementById('total-calls').textContent = stats.total_calls;
    document.getElementById('day-shifts').textContent = stats.total_day_shifts;
    document.getElementById('days-off').textContent = stats.days_off;

    // Render upcoming shifts
    const shiftsHtml = summary.upcoming_shifts.map(shift => {
        const icon = shift.shift_type === 'call' ? '🌙' :
                     shift.shift_type === 'off' ? '🏖️' : '☀️';
        const dateStr = formatDateDisplay(shift.date);
        const tags = (shift.tags && shift.tags.length > 0)
            ? `<span class="shift-tags">${shift.tags.join(', ')}</span>`
            : '<span class="muted">-</span>';
        return `
            <tr>
                <td>${icon} ${dateStr}</td>
                <td>${shift.shift_type}</td>
                <td>${shift.shift}</td>
                <td>${tags}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('upcoming-shifts').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Shift</th>
                    <th>Notes</th>
                </tr>
            </thead>
            <tbody>${shiftsHtml || '<tr><td colspan="4">No upcoming shifts</td></tr>'}</tbody>
        </table>
    `;

    // Render weekly breakdown
    const weeklyHtml = summary.weekly_breakdown.map(week => `
        <div class="week-summary">
            <strong>${week.week_of}</strong>: ${week.calls} calls, ${week.day_shifts} day shifts
        </div>
    `).join('');

    document.getElementById('weekly-breakdown').innerHTML = weeklyHtml || '<p>No data</p>';

    hideLoading('my-schedule-content');
}

// Tab 2: Golden Weekends
function initGoldenWeekendsTab() {
    const weeksSlider = document.getElementById('golden-weeks');
    const weeksValue = document.getElementById('golden-weeks-value');
    const searchBtn = document.getElementById('btn-golden-search');

    weeksSlider.addEventListener('input', (e) => {
        weeksValue.textContent = e.target.value;
    });

    searchBtn.addEventListener('click', () => {
        const weeks = parseInt(weeksSlider.value);
        const showAvailable = document.getElementById('golden-show-available').checked;

        renderGoldenWeekends(weeks, showAvailable);
    });
}

function renderGoldenWeekends(weeksAhead, showAvailable) {
    showLoading('golden-results');

    const weekends = findGoldenWeekends(SCHEDULE, MY_NAME, weeksAhead);

    // Only show weekends where I'm off (that's the whole point of golden weekends)
    const myGoldenWeekends = weekends.filter(w => w.i_am_off);

    if (myGoldenWeekends.length === 0) {
        document.getElementById('golden-results').innerHTML =
            '<p class="no-data">😢 No golden weekends found in the next ' + weeksAhead + ' weeks</p>';
        return;
    }

    const friendsData = getFriends();
    const friendsSet = new Set(friendsData.friends || []);

    const html = myGoldenWeekends.map((weekend, idx) => {
        // Determine who to show as available
        let availablePeople = weekend.all_residents_off || [];

        const friendsAvailable = availablePeople.filter(name => friendsSet.has(name));
        const othersAvailable = availablePeople.filter(name => !friendsSet.has(name));

        const emoji = friendsAvailable.length >= 3 ? '🌟' :
                      friendsAvailable.length >= 1 ? '✨' : '🏖️';

        let availableHtml = '';
        if (showAvailable) {
            if (friendsAvailable.length > 0) {
                const friendsLabel = friendsAvailable.map(formatLastName).join(', ');
                availableHtml += `<p><strong>Friends off:</strong> ${friendsLabel}</p>`;
            }
            if (othersAvailable.length > 0) {
                const othersLabel = othersAvailable.slice(0, 10).map(formatLastName).join(', ');
                availableHtml += `<p><small>Others off: ${othersLabel}${othersAvailable.length > 10 ? '...' : ''}</small></p>`;
            }
            if (availablePeople.length === 0) {
                availableHtml = '<p class="muted">No one else is off this weekend</p>';
            }
        }

        return `
        <div class="golden-card">
            <div class="golden-header">
                <span class="golden-date">${emoji} ${weekend.weekend}</span>
                ${showAvailable ? `<span class="available-count">${availablePeople.length} available</span>` : ''}
            </div>
            ${showAvailable ? `<div class="golden-body">${availableHtml}</div>` : ''}
        </div>
    `}).join('');

    document.getElementById('golden-results').innerHTML = `
        <p class="success-message">🎉 Found ${myGoldenWeekends.length} golden weekend${myGoldenWeekends.length > 1 ? 's' : ''}!</p>
        ${html}
    `;
}


// Tab 3: Trip Planner
function initTripPlannerTab() {
    const tripStartInput = document.getElementById('trip-start');
    const tripEndInput = document.getElementById('trip-end');

    // Default trip start to the next upcoming weekend (Saturday)
    if (tripStartInput && !tripStartInput.value) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nextSat = findNextSaturday(today);
        tripStartInput.value = formatDate(nextSat);
        const defaultEnd = addDays(nextSat, 2);
        if (tripEndInput) {
            tripEndInput.value = formatDate(defaultEnd);
        }
    }

    // Auto-set trip end to 2 days after trip start
    if (tripStartInput && tripEndInput) {
        tripStartInput.addEventListener('change', () => {
            if (!tripStartInput.value) return;
            const start = parseDate(tripStartInput.value);
            tripEndInput.value = formatDate(addDays(start, 2));
        });
    }

    document.getElementById('btn-trip-search').addEventListener('click', () => {
        const startDate = document.getElementById('trip-start').value;
        const endDate = document.getElementById('trip-end').value;
        const departEvening = document.getElementById('trip-depart-evening').checked;
        const friendsOnly = document.getElementById('trip-friends-only').checked;
        const showCRNA = document.getElementById('trip-show-crna').checked;

        if (!startDate || !endDate) {
            alert('Please select both start and end dates');
            return;
        }

        renderTripPlanner(startDate, endDate, departEvening, friendsOnly, showCRNA);
    });

    const tripShowHidden = document.getElementById('trip-show-hidden');
    if (tripShowHidden) {
        tripShowHidden.addEventListener('change', () => {
            const startDate = document.getElementById('trip-start').value;
            const endDate = document.getElementById('trip-end').value;
            if (startDate && endDate) {
                renderTripPlanner(
                    startDate,
                    endDate,
                    document.getElementById('trip-depart-evening').checked,
                    document.getElementById('trip-friends-only').checked,
                    document.getElementById('trip-show-crna').checked
                );
            }
        });
    }

    const tripResetHidden = document.getElementById('trip-reset-hidden');
    if (tripResetHidden) {
        tripResetHidden.addEventListener('click', () => {
            saveHiddenCandidates('qgenda_hidden_trip', new Set());
            const startDate = document.getElementById('trip-start').value;
            const endDate = document.getElementById('trip-end').value;
            if (startDate && endDate) {
                renderTripPlanner(
                    startDate,
                    endDate,
                    document.getElementById('trip-depart-evening').checked,
                    document.getElementById('trip-friends-only').checked,
                    document.getElementById('trip-show-crna').checked
                );
            }
        });
    }
}

/**
 * Find people who are FREE on the given dates (for trip coverage)
 * @param {Array} schedule - Full schedule array
 * @param {string} myName - Your name (to exclude)
 * @param {Array} dates - Array of date strings (YYYY-MM-DD) to check
 * @returns {Array} Array of candidates sorted by how many dates they can cover
 */
function findCoverageCandidates(schedule, myName, dates) {
    // Include CA shifts, CRNA shifts, and Fellow shifts in the relevant schedule
    const relevantSchedule = schedule.filter(s => s.shift && (
        s.shift.startsWith('CA ') ||
        s.shift.includes('CRNA') ||
        s.shift.startsWith('Fellow')
    ));

    // Get all potential candidates (residents, CRNAs, fellows)
    const allResidents = new Set(relevantSchedule.map(s => s.name));
    allResidents.delete(myName);

    // Unavailable shift types - include day shifts since they're working
    const unavailableShifts = new Set([...CALL_SHIFTS, ...UNAVAILABLE_SHIFTS, ...ICU_SHIFTS, ...DAY_SHIFTS]);

    const candidates = [];

    for (const resident of allResidents) {
        const freeDates = [];

        for (const dateStr of dates) {
            const dateObj = parseDate(dateStr);
            // Check all their shifts (not just CA shifts) to determine availability
            const theirShifts = getShiftsOnDate(schedule, resident, dateObj);
            const shiftTypes = new Set(theirShifts.map(s => s.shift));

            // They're free if they have no shifts or only non-blocking shifts
            const isFree = shiftTypes.size === 0 || !setsIntersect(shiftTypes, unavailableShifts);

            // Also check day before for night call conflicts
            const dayBefore = addDays(dateObj, -1);
            const dayBeforeShifts = getShiftsOnDate(schedule, resident, dayBefore);
            const hasNightCallDayBefore = dayBeforeShifts.some(s => NIGHT_CALL_SHIFTS.has(s.shift));

            // Check if they are eligible to cover my shift on that date
            const myShiftsOnDate = getShiftsOnDate(schedule, myName, dateObj);
            const POST_CALL_SHIFTS = new Set(['CA Post Call', 'CA Home Post Call']);
            const myBlockingShift = myShiftsOnDate.find(s => !POST_CALL_SHIFTS.has(s.shift));
            const canCover = myBlockingShift ? canCoverShift(resident, myBlockingShift.shift) : true;

            if (isFree && !hasNightCallDayBefore && canCover) {
                freeDates.push(dateStr);
            }
        }

        if (freeDates.length > 0) {
            candidates.push({
                name: resident,
                free_dates: freeDates,
                coverage_count: freeDates.length,
                covers_all: freeDates.length === dates.length
            });
        }
    }

    // Sort: residents first, then covers all, then coverage count, then friends
    const friendsData = getFriends();
    candidates.sort((a, b) => {
        // Residents before CRNAs (CRNAs are harder to get)
        const aResident = isResident(a.name) ? 1 : 0;
        const bResident = isResident(b.name) ? 1 : 0;
        if (aResident !== bResident) return bResident - aResident;

        // Friends first
        const aFriend = friendsData.friends.includes(a.name) ? 1 : 0;
        const bFriend = friendsData.friends.includes(b.name) ? 1 : 0;
        if (aFriend !== bFriend) return bFriend - aFriend;

        // Covers all dates
        if (a.covers_all !== b.covers_all) return b.covers_all ? 1 : -1;

        // Then by coverage count
        return b.coverage_count - a.coverage_count;
    });

    // Add type info to each candidate
    candidates.forEach(c => {
        c.type = getPersonType(c.name);
    });

    return candidates;
}

function renderTripPlanner(startDate, endDate, departEvening, friendsOnly, showCRNA) {
    showLoading('trip-shifts');

    const showHidden = document.getElementById('trip-show-hidden')?.checked || false;
    const hiddenSet = getHiddenCandidates('qgenda_hidden_trip');

    const result = findTripCoverage(SCHEDULE, MY_NAME, startDate, endDate, departEvening);

    // Show data warning prominently if schedule doesn't cover the requested dates
    let dataWarningHtml = '';
    if (result.data_warning) {
        const scheduleEndDate = result.data_warning.scheduleEnd ?
            formatDateDisplay(result.data_warning.scheduleEnd) : '';
        dataWarningHtml = `
            <div class="data-warning-banner">
                <strong>⚠️ INCOMPLETE DATA</strong>
                <p>${result.data_warning.message}</p>
                <p>Your trip dates extend beyond available schedule data. Results may be incomplete or inaccurate.</p>
            </div>
        `;
    }

    syncRotationOverridesUI();

    // Render vacation eligibility banner (uses rotation-ineligible shifts)
    renderVacationEligibility(startDate, endDate, result.data_warning);

    // Only show shifts that actually block travel (need coverage)
    const blockingOnly = result.blocking_shifts.filter(s => s.blocks_travel);

    // Group by date to avoid showing same date multiple times
    const byDate = {};
    for (const shift of blockingOnly) {
        const dateStr = formatDate(shift.date);
        if (!byDate[dateStr]) {
            byDate[dateStr] = [];
        }
        byDate[dateStr].push(shift);
    }

    // Render blocking shifts grouped by date
    // Filter out Post Call markers - they're not real shifts to swap
    const POST_CALL_MARKERS = new Set(['CA Post Call', 'CA Home Post Call']);
    const blockingHtml = Object.entries(byDate).map(([dateStr, shifts]) => {
        const dateDisplay = formatDateDisplay(parseDate(dateStr));
        const realShifts = shifts.filter(s => !POST_CALL_MARKERS.has(s.shift));
        const shiftList = realShifts.map(s => s.shift.replace('CA ', '')).join(', ');
        if (realShifts.length === 0) return ''; // Skip if only post-call
        return `
        <div class="blocking-shift blocks">
            <strong>🚫 ${dateDisplay}</strong> - ${shiftList}
            <small>(${realShifts[0].reason})</small>
        </div>
    `}).join('');

    // Filter out post-call markers to get actual shifts needing coverage
    const actualBlockingShifts = blockingOnly.filter(s => !POST_CALL_MARKERS.has(s.shift));
    const blockedDates = [...new Set(actualBlockingShifts.map(s => formatDate(s.date)))];

    if (actualBlockingShifts.length === 0) {
        document.getElementById('trip-shifts').innerHTML = dataWarningHtml +
            '<p class="success-message">✅ No blocking shifts - you\'re free to travel!</p>';
    } else {
        document.getElementById('trip-shifts').innerHTML = dataWarningHtml + `
            <p class="warning-message">⚠️ ${actualBlockingShifts.length} shift(s) need coverage:</p>
            ${blockingHtml}
        `;
    }

    // Package Deals removed - Swap Suggestions are more useful and actionable
    document.getElementById('trip-packages').innerHTML = '';
    const coverageCandidates = findCoverageCandidates(SCHEDULE, MY_NAME, blockedDates);

    let filtered = coverageCandidates;
    if (friendsOnly) {
        const friendsData = getFriends();
        filtered = coverageCandidates.filter(c => friendsData.friends.includes(c.name));
    }

    // Filter by person type (residents and fellows always shown, CRNAs optional)
    // Exclude interns - they can't cover call shifts
    filtered = filtered.filter(c => {
        const ptype = getPersonType(c.name);
        if (ptype === 'intern') return false;  // Interns can't cover call
        if (isResident(c.name)) return true;  // Show CA1-CA3
        if (ptype === 'crna' && showCRNA) return true;
        if (ptype === 'fellow') return true;  // Always show fellows
        return false;
    });

    // Render coverage candidates
    const residents = filtered.filter(c => c.type === 'resident');
    const crnas = filtered.filter(c => c.type === 'crna');
    const others = filtered.filter(c => c.type !== 'resident' && c.type !== 'crna');

    let candidatesHtml = '';

    if (filtered.length === 0) {
        candidatesHtml = '<p class="no-data">No one found who is free on the blocked dates</p>';
    } else {
        const renderCandidates = (list, label) => {
            if (list.length === 0) return '';
            let html = `<h4>${label} (${list.length})</h4><div class="coverage-candidates">`;
            list.slice(0, 15).forEach(c => {
                const friendsData = getFriends();
                const isFriend = friendsData.friends.includes(c.name);
                const isSamaritan = friendsData.good_samaritans.includes(c.name);
                const coversAll = c.covers_all ? 'covers-all' : '';
                const personType = getPersonType(c.name);
                const typeLabel = getTypeLabel(personType);
                const typeClass = getTypeClass(personType);
                html += `
                    <div class="coverage-candidate ${isFriend ? 'is-friend' : ''} ${coversAll}">
                        <strong>${c.name}</strong>
                        ${typeLabel ? `<span class="badge ${typeClass}">${typeLabel}</span>` : ''}
                        ${isFriend ? '<span class="badge friend-badge">Friend</span>' : ''}
                        ${isSamaritan ? '<span class="badge samaritan">😇</span>' : ''}
                        ${c.covers_all ? '<span class="badge covers-all-badge">✓ All</span>' : ''}
                        <div class="coverage-dates">Free: ${c.free_dates.map(d => formatDateDisplay(parseDate(d)).split(' ')[1]).join(', ')}</div>
                    </div>
                `;
            });
            html += '</div>';
            return html;
        };

        candidatesHtml = renderCandidates(residents, 'Residents');
        if (crnas.length > 0) {
            candidatesHtml += renderCandidates(crnas, 'CRNAs (harder to get)');
        }
        if (others.length > 0) {
            candidatesHtml += renderCandidates(others, 'Others');
        }
    }
    document.getElementById('trip-candidates').innerHTML = candidatesHtml;

    // Render swap suggestions if there are blocked dates
    if (blockedDates.length > 0) {
        const swapResults = findTripSwapOpportunities(SCHEDULE, MY_NAME, blockedDates, 4);
        let swapsHtml = '';

        // Good Samaritans section
        if (swapResults.goodSamaritans.length > 0) {
            swapsHtml += '<h4>😇 Good Samaritans (No Swap Needed)</h4>';
            swapsHtml += '<div class="trip-samaritans">';
            swapResults.goodSamaritans.forEach(sam => {
                const dateList = sam.canCoverDates.map(d => formatDateDisplay(parseDate(d)).split(' ')[1]).join(', ');
                swapsHtml += `
                    <div class="samaritan-card">
                        <strong>${sam.name}</strong>
                        ${sam.coversAll ? '<span class="badge covers-all-badge">✓ All</span>' : ''}
                        <div class="samaritan-dates">Can cover: ${dateList}</div>
                        <div class="samaritan-tip">💡 Can ask directly - no swap needed!</div>
                    </div>
                `;
            });
            swapsHtml += '</div>';
        }

        // Swap Suggestions section
        if (swapResults.swapSuggestions.length > 0) {
            // Filter by CRNA and friends settings
            let filteredSwaps = swapResults.swapSuggestions;
            if (friendsOnly) {
                filteredSwaps = filteredSwaps.filter(s => s.isFriend);
            }
            if (!showHidden) {
                filteredSwaps = filteredSwaps.filter(s => !hiddenSet.has(s.candidate));
            }
            filteredSwaps = filteredSwaps.filter(s => {
                const ptype = getPersonType(s.candidate);
                if (ptype === 'intern') return false;  // Interns can't cover call
                if (isResident(s.candidate)) return true;  // Show CA1-CA3
                if (ptype === 'crna' && showCRNA) return true;
                if (ptype === 'fellow') return true;
                return false;
            });

            if (filteredSwaps.length > 0) {
                swapsHtml += '<h4>💱 Swap Suggestions</h4>';
                swapsHtml += '<p class="swap-suggestions-hint">Offer to take their shift in exchange for coverage</p>';
                swapsHtml += '<div class="trip-swap-cards" id="trip-swap-cards-container">';

                const initialLimit = 5;
                filteredSwaps.forEach((swap, index) => {
                    const easeClass = swap.ease.toLowerCase().replace(' ', '-');
                    const personType = getPersonType(swap.candidate);
                    const typeLabel = getTypeLabel(personType);
                    const typeClass = getTypeClass(personType);
                    const blockedDateDisplay = formatDateDisplay(parseDate(swap.blockedDate));
                    const theirDateDisplay = formatDateDisplay(parseDate(swap.theirDate));
                    const hiddenClass = index >= initialLimit ? 'swap-card-hidden' : '';
                    const isHidden = hiddenSet.has(swap.candidate);
                    const hiddenStyle = isHidden ? 'hidden-candidate' : '';
                    const hiddenBtnLabel = isHidden ? 'Unhide' : 'Hide';
                    const escapedName = swap.candidate.replace(/'/g, "\\'");

                    swapsHtml += `
                        <div class="trip-swap-card ease-${easeClass} ${hiddenClass} ${hiddenStyle}">
                            <div class="swap-header">
                                <span class="candidate-name">
                                    ${swap.candidate}
                                    ${typeLabel ? `<span class="type-badge ${typeClass}">${typeLabel}</span>` : ''}
                                    ${swap.isFriend ? '<span class="type-badge friend">Friend</span>' : ''}
                                </span>
                                <span class="ease-badge ${easeClass}">${swap.ease}</span>
                            </div>
                            <div class="swap-details">
                                <div class="swap-give">
                                    <span class="label">You work:</span>
                                    <span class="swap-shift">${theirDateDisplay} - ${swap.theirShift.replace('CA ', '')}</span>
                                </div>
                                <div class="swap-arrow">↔</div>
                                <div class="swap-get">
                                    <span class="label">They cover:</span>
                                    <span class="swap-shift">${blockedDateDisplay} - ${swap.myShift.replace('CA ', '')}</span>
                                </div>
                            </div>
                            <button class="secondary hide-candidate-btn" onclick="toggleHiddenCandidate('trip', '${escapedName}', ${!isHidden})">${hiddenBtnLabel}</button>
                        </div>
                    `;
                });
                swapsHtml += '</div>';

                // Add expand button if there are more than 5
                if (filteredSwaps.length > initialLimit) {
                    const hiddenCount = filteredSwaps.length - initialLimit;
                    swapsHtml += `
                        <button class="expand-swaps-btn" id="expand-swaps-btn" onclick="expandTripSwaps()">
                            Show ${hiddenCount} more suggestion${hiddenCount > 1 ? 's' : ''}
                        </button>
                    `;
                }
            }
        }

        document.getElementById('trip-swaps').innerHTML = swapsHtml;
    } else {
        document.getElementById('trip-swaps').innerHTML = '';
    }

    hideLoading('trip-shifts');
}

// Expand hidden trip swap suggestions
function expandTripSwaps() {
    const hiddenCards = document.querySelectorAll('.trip-swap-card.swap-card-hidden');
    hiddenCards.forEach(card => card.classList.remove('swap-card-hidden'));
    const btn = document.getElementById('expand-swaps-btn');
    if (btn) btn.remove();
}

// Tab 4: Weekend Swap

/**
 * Get all weekends where I have call or day shifts (working weekends)
 * @returns {Array} Array of weekend objects with saturday, sunday, shifts, and type
 */
function getMyWorkingWeekends() {
    const weekends = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = addDays(today, 90); // Look 3 months ahead

    let current = findNextSaturday(today);
    while (current <= endDate) {
        const sunday = addDays(current, 1);
        const satShifts = SCHEDULE.filter(s =>
            s.name === MY_NAME &&
            s.date === formatDate(current) &&
            (CALL_SHIFTS.has(s.shift) || DAY_SHIFTS.has(s.shift))
        );
        const sunShifts = SCHEDULE.filter(s =>
            s.name === MY_NAME &&
            s.date === formatDate(sunday) &&
            (CALL_SHIFTS.has(s.shift) || DAY_SHIFTS.has(s.shift))
        );

        if (satShifts.length > 0 || sunShifts.length > 0) {
            const satShiftSet = new Set(satShifts.map(s => s.shift));
            const sunShiftSet = new Set(sunShifts.map(s => s.shift));
            weekends.push({
                saturday: current,
                sunday: sunday,
                satShift: satShifts[0]?.shift || 'OFF',
                sunShift: sunShifts[0]?.shift || 'OFF',
                type: classifyWeekendType(satShiftSet, sunShiftSet)
            });
        }
        current = addDays(current, 7);
    }
    return weekends;
}

function initWeekendSwapTab() {
    const weeksSlider = document.getElementById('weekend-weeks');
    const weeksValue = document.getElementById('weekend-weeks-value');

    // Populate dropdown with working weekends
    populateWeekendDropdown();

    // Update weeks value display
    weeksSlider.addEventListener('input', (e) => {
        weeksValue.textContent = e.target.value;
    });

    // Search button
    document.getElementById('btn-weekend-search').addEventListener('click', () => {
        const select = document.getElementById('weekend-select');
        const selectedIdx = select.value;
        const weeksToSearch = parseInt(weeksSlider.value);
        const friendsOnly = document.getElementById('weekend-friends-only').checked;
        const showCRNA = document.getElementById('weekend-show-crna').checked;

        if (selectedIdx === '' || !window.myWorkingWeekends || !window.myWorkingWeekends[selectedIdx]) {
            alert('Please select a weekend');
            return;
        }

        const weekend = window.myWorkingWeekends[selectedIdx];
        renderWeekendSwap(weekend, weeksToSearch, friendsOnly, showCRNA);
    });

    const weekendShowHidden = document.getElementById('weekend-show-hidden');
    if (weekendShowHidden) {
        weekendShowHidden.addEventListener('change', () => {
            if (window.lastWeekendSearch) {
                const p = window.lastWeekendSearch;
                renderWeekendSwap(p.weekend, p.weeksToSearch, p.friendsOnly, p.showCRNA);
            }
        });
    }

    const weekendResetHidden = document.getElementById('weekend-reset-hidden');
    if (weekendResetHidden) {
        weekendResetHidden.addEventListener('click', () => {
            saveHiddenCandidates('qgenda_hidden_weekend', new Set());
            if (window.lastWeekendSearch) {
                const p = window.lastWeekendSearch;
                renderWeekendSwap(p.weekend, p.weeksToSearch, p.friendsOnly, p.showCRNA);
            }
        });
    }
}

function renderWeekendSwap(weekend, weeksToSearch, friendsOnly, showCRNA) {
    showLoading('weekend-results');

    const satDate = weekend.saturday;
    const sunDate = weekend.sunday;
    const myWeekendShiftSet = new Set([weekend.satShift, weekend.sunShift].filter(s => s && s !== 'OFF'));

    if (setsIntersect(myWeekendShiftSet, ICU_SHIFTS)) {
        document.getElementById('weekend-results').innerHTML =
            '<p class="warning-message">⚠️ ICU weekend assignments (e.g., CTICU/SICU/ICU Call) are not eligible for weekend swaps.</p>';
        hideLoading('weekend-results');
        return;
    }

    let swaps = findWeekendSwap(SCHEDULE, MY_NAME, [satDate, sunDate], weeksToSearch, weeksToSearch);

    const showHidden = document.getElementById('weekend-show-hidden')?.checked || false;
    const hiddenSet = getHiddenCandidates('qgenda_hidden_weekend');

    // Store for message generation
    window.currentWeekendSwaps = swaps;
    window.myWeekend = weekend;
    window.myWeekendStr = `${formatDateDisplay(satDate)} - ${formatDateDisplay(sunDate)}`;
    window.lastWeekendSearch = { weekend, weeksToSearch, friendsOnly, showCRNA };

    // Show my weekend info
    const myTypeIcon = weekend.type === 'night' ? '🌙' : weekend.type === 'day' ? '☀️' : '📅';
    document.getElementById('my-weekend-info').innerHTML = `
        <div class="my-weekend-summary">
            <strong>Your Weekend:</strong> ${myTypeIcon} ${window.myWeekendStr}
            <br><small>Sat: ${weekend.satShift} | Sun: ${weekend.sunShift}</small>
        </div>
    `;

    if (friendsOnly) {
        swaps = swaps.filter(swap => getFriends().friends.includes(swap.candidate));
    }

    // Filter by person type (show residents by default, optionally CRNAs)
    swaps = swaps.filter(swap => {
        const ptype = getPersonType(swap.candidate);
        if (isResident(swap.candidate) && getPersonType(swap.candidate) !== 'intern') return true;  // Show residents except interns
        if (ptype === 'crna' && showCRNA) return true;
        if (ptype === 'fellow') return true;  // Always show fellows
        return false;
    });

    if (!showHidden) {
        swaps = swaps.filter(swap => !hiddenSet.has(swap.candidate));
    }

    // Sort: easiest first, then full weekend off, then friends, then benefit
    const easeOrder = { 'easy': 0, 'moderate': 1, 'hard sell': 2, 'very hard': 3 };
    const friendsData = getFriends();
    swaps.sort((a, b) => {
        const easeA = easeOrder[(a.ease || '').trim().toLowerCase()] ?? 99;
        const easeB = easeOrder[(b.ease || '').trim().toLowerCase()] ?? 99;
        if (easeA !== easeB) return easeA - easeB;

        const aTheirType = (a.their_weekend_type || (a.swap_type.split('↔')[1] || '')).toLowerCase();
        const bTheirType = (b.their_weekend_type || (b.swap_type.split('↔')[1] || '')).toLowerCase();
        const aOff = aTheirType === 'off' ? 0 : 1;
        const bOff = bTheirType === 'off' ? 0 : 1;
        if (aOff !== bOff) return aOff - bOff;

        const friendA = friendsData.friends.includes(a.candidate) ? 0 : 1;
        const friendB = friendsData.friends.includes(b.candidate) ? 0 : 1;
        if (friendA !== friendB) return friendA - friendB;

        const benefitA = typeof a.benefit === 'number' ? a.benefit : 0;
        const benefitB = typeof b.benefit === 'number' ? b.benefit : 0;
        return benefitB - benefitA;
    });

    // Update the stored swaps with new order
    window.currentWeekendSwaps = swaps;

    if (swaps.length === 0) {
        document.getElementById('weekend-results').innerHTML = '<p class="no-data">No swap candidates found</p>';
        hideLoading('weekend-results');
        return;
    }

    const html = swaps.map((swap, idx) => {
        const easeClass = swap.ease === 'Easy' ? 'ease-easy' :
                         swap.ease === 'Moderate' ? 'ease-moderate' :
                         swap.ease === 'Hard sell' ? 'ease-hard' : 'ease-very-hard';

        const easeBadgeClass = swap.ease === 'Easy' ? 'easy' :
                              swap.ease === 'Moderate' ? 'moderate' :
                              swap.ease === 'Hard sell' ? 'hard' : 'very-hard';

        const easeEmoji = swap.ease === 'Easy' ? '✅' :
                         swap.ease === 'Moderate' ? '⚠️' :
                         swap.ease === 'Hard sell' ? '🔴' : '⛔';

        // Determine shift type for badges
        const theirSatIsNight = CALL_SHIFTS.has(swap.their_sat_shift) || swap.their_sat_shift.includes('Night') || swap.their_sat_shift.includes('Call');
        const theirSunIsNight = CALL_SHIFTS.has(swap.their_sun_shift) || swap.their_sun_shift.includes('Night') || swap.their_sun_shift.includes('Call');
        const theirSatClass = swap.their_sat_shift === 'OFF' ? 'off' : theirSatIsNight ? 'night' : 'day';
        const theirSunClass = swap.their_sun_shift === 'OFF' ? 'off' : theirSunIsNight ? 'night' : 'day';

        const mySatIsNight = CALL_SHIFTS.has(weekend.satShift) || weekend.satShift.includes('Night') || weekend.satShift.includes('Call');
        const mySunIsNight = CALL_SHIFTS.has(weekend.sunShift) || weekend.sunShift.includes('Night') || weekend.sunShift.includes('Call');
        const mySatClass = weekend.satShift === 'OFF' ? 'off' : mySatIsNight ? 'night' : 'day';
        const mySunClass = weekend.sunShift === 'OFF' ? 'off' : mySunIsNight ? 'night' : 'day';

        const mySatIcon = mySatClass === 'night' ? '🌙' : mySatClass === 'off' ? '🏖️' : '☀️';
        const mySunIcon = mySunClass === 'night' ? '🌙' : mySunClass === 'off' ? '🏖️' : '☀️';
        const theirSatIcon = theirSatClass === 'night' ? '🌙' : theirSatClass === 'off' ? '🏖️' : '☀️';
        const theirSunIcon = theirSunClass === 'night' ? '🌙' : theirSunClass === 'off' ? '🏖️' : '☀️';

        const personType = getPersonType(swap.candidate);
        const typeLabel = getTypeLabel(personType);
        const typeClass = getTypeClass(personType);
        const isCRNA = personType === 'crna';
        const isFriend = friendsData.friends.includes(swap.candidate);
        const isHidden = hiddenSet.has(swap.candidate);
        const hiddenStyle = isHidden ? 'hidden-candidate' : '';
        const hiddenBtnLabel = isHidden ? 'Unhide' : 'Hide';
        const escapedName = swap.candidate.replace(/'/g, "\\'");

        const yourWeekendLines = [];
        if (weekend.satShift !== 'OFF') {
            yourWeekendLines.push(
                `<div class="swap-line"><span class="shift ${mySatClass}">${mySatIcon} ${weekend.satShift}</span><span class="swap-date">On ${formatDateDisplay(weekend.saturday).split(' ')[1]}</span></div>`
            );
        }
        if (weekend.sunShift !== 'OFF') {
            yourWeekendLines.push(
                `<div class="swap-line"><span class="shift ${mySunClass}">${mySunIcon} ${weekend.sunShift}</span><span class="swap-date">On ${formatDateDisplay(weekend.sunday).split(' ')[1]}</span></div>`
            );
        }
        const yourWeekendBody = yourWeekendLines.length
            ? yourWeekendLines.join('')
            : '<div class="swap-line muted">No shifts (already off)</div>';

        const theirWeekendLines = [];
        if (swap.their_sat_shift !== 'OFF') {
            theirWeekendLines.push(
                `<div class="swap-line"><span class="shift ${theirSatClass}">${theirSatIcon} ${swap.their_sat_shift}</span><span class="swap-date">On ${formatDateDisplay(swap.saturday).split(' ')[1]}</span></div>`
            );
        }
        if (swap.their_sun_shift !== 'OFF') {
            theirWeekendLines.push(
                `<div class="swap-line"><span class="shift ${theirSunClass}">${theirSunIcon} ${swap.their_sun_shift}</span><span class="swap-date">On ${formatDateDisplay(swap.sunday).split(' ')[1]}</span></div>`
            );
        }
        const theirWeekendBody = theirWeekendLines.length
            ? theirWeekendLines.join('')
            : '<div class="swap-line muted">No shifts (already off)</div>';

        return `
            <div class="swap-card ${easeClass} ${isCRNA ? 'is-crna' : ''} ${hiddenStyle}">
                <div class="swap-header">
                    <span class="candidate-name">
                        ${swap.candidate}
                        ${typeLabel ? `<span class="type-badge ${typeClass}">${typeLabel}</span>` : ''}
                        ${isFriend ? '<span class="type-badge friend">Friend</span>' : ''}
                    </span>
                    <span class="ease-badge ${easeBadgeClass}">${easeEmoji} ${swap.ease}</span>
                </div>
                <div class="swap-details">
                    <div class="swap-sides">
                        <div class="swap-side">
                            <div class="swap-side-title">You get off (they cover) <span class="swap-date">${window.myWeekendStr}</span></div>
                            <div class="swap-side-body">
                                ${yourWeekendBody}
                            </div>
                        </div>
                        <div class="swap-side">
                            <div class="swap-side-title">They get off (you cover) <span class="swap-date">${swap.their_weekend}</span></div>
                            <div class="swap-side-body">
                                ${theirWeekendBody}
                            </div>
                        </div>
                    </div>
                </div>
                <button class="select-btn" onclick="selectSwapCandidate(${idx})" ${isHidden ? 'disabled' : ''}>Generate Message</button>
                <button class="secondary hide-candidate-btn" onclick="toggleHiddenCandidate('weekend', '${escapedName}', ${!isHidden})">${hiddenBtnLabel}</button>
            </div>
        `;
    }).join('');

    document.getElementById('weekend-results').innerHTML = html;
    hideLoading('weekend-results');
}

window.selectSwapCandidate = function(idx) {
    const swap = window.currentWeekendSwaps[idx];
    if (!swap) return;

    window.selectedSwapCandidate = swap;

    // Get my actual shifts for the weekend
    const weekend = window.myWeekend;
    const myShifts = `${weekend.satShift}/${weekend.sunShift}`;

    // Generate message using swap-finder's generateSwapMessage
    const message = generateSwapMessage(
        swap.candidate,
        myShifts,
        window.myWeekendStr,
        `${swap.their_sat_shift}/${swap.their_sun_shift}`,
        swap.their_weekend,
        swap.ease,
        'weekend'
    );

    document.getElementById('swap-message').value = message;

    // Scroll to message textarea
    document.getElementById('swap-message').scrollIntoView({ behavior: 'smooth' });
};

// generateSwapMessage is provided by swap-finder.js

// Tab 5: Assignments
function initWhosFreeTab() {
    document.getElementById('btn-free-check').addEventListener('click', () => {
        const date = document.getElementById('free-date').value;
        const friendsOnly = document.getElementById('free-friends-only').checked;
        const showCRNA = document.getElementById('free-show-crna').checked;

        if (!date) {
            alert('Please select a date');
            return;
        }

        renderWhosFree(date, friendsOnly, showCRNA);
    });
}

function renderWhosFree(date, friendsOnly, showCRNA) {
    showLoading('free-results');

    // Get all shifts on this date that make someone unavailable
    const busyShifts = SCHEDULE.filter(s => {
        if (s.date !== date) return false;
        // Call, day, ICU, or unavailable shifts mean they're not free
        return CALL_SHIFTS.has(s.shift) ||
               DAY_SHIFTS.has(s.shift) ||
               ICU_SHIFTS.has(s.shift) ||
               UNAVAILABLE_SHIFTS.has(s.shift);
    });
    const busyNames = new Set(busyShifts.map(s => s.name));

    let allPeople = getAllResidents();
    if (friendsOnly) {
        const friends = getFriends();
        allPeople = allPeople.filter(name => friends.friends.includes(name));
    }

    // Filter by person type
    allPeople = allPeople.filter(name => {
        const ptype = getPersonType(name);
        if (isResident(name)) return true;  // Always show residents
        if (ptype === 'crna' && showCRNA) return true;
        if (ptype === 'fellow') return true;  // Always show fellows
        return false;
    });

    const freeResidents = allPeople.filter(name => !busyNames.has(name));

    // Get what each free person is doing that day
    const html = freeResidents.length > 0
        ? freeResidents.map(name => {
            const theirShifts = SCHEDULE.filter(s => s.date === date && s.name === name);
            const shifts = theirShifts.length > 0
                ? theirShifts.map(s => s.shift).join(', ')
                : 'OFF';
            return `<div class="free-resident"><strong>${name}</strong>: ${shifts}</div>`;
        }).join('')
        : '<p class="no-data">No available residents found on this date</p>';

    document.getElementById('free-results').innerHTML = html;
    hideLoading('free-results');
}

// Tab 6: Friends List
function initFriendsTab() {
    renderFriendsList();

    document.getElementById('btn-add-friend').addEventListener('click', () => {
        const select = document.getElementById('new-friend-select');
        const note = document.getElementById('new-friend-note').value;
        const prefersNights = document.getElementById('new-friend-nights').checked;
        const isSamaritan = document.getElementById('new-friend-samaritan').checked;

        if (!select.value) {
            alert('Please select a friend to add');
            return;
        }

        const friendsData = getFriends();
        if (!friendsData.friends.includes(select.value)) {
            friendsData.friends.push(select.value);
        }

        if (note) {
            friendsData.notes[select.value] = note;
        }

        // Handle prefers nights
        if (prefersNights && !friendsData.prefers_nights.includes(select.value)) {
            friendsData.prefers_nights.push(select.value);
        } else if (!prefersNights) {
            friendsData.prefers_nights = friendsData.prefers_nights.filter(f => f !== select.value);
        }

        // Handle good samaritan
        if (isSamaritan && !friendsData.good_samaritans.includes(select.value)) {
            friendsData.good_samaritans.push(select.value);
        } else if (!isSamaritan) {
            friendsData.good_samaritans = friendsData.good_samaritans.filter(f => f !== select.value);
        }

        saveFriends(friendsData);
        renderFriendsList();

        select.value = '';
        document.getElementById('new-friend-note').value = '';
        document.getElementById('new-friend-nights').checked = false;
        document.getElementById('new-friend-samaritan').checked = false;
    });
}

function renderFriendsList() {
    const friendsData = getFriends();

    const html = friendsData.friends.map(friend => {
        const note = friendsData.notes[friend] || '';
        const prefersNights = friendsData.prefers_nights.includes(friend);
        const isSamaritan = friendsData.good_samaritans.includes(friend);

        return `
            <div class="friend-item">
                <div class="friend-info">
                    <div class="friend-name">${friend}</div>
                    <div class="friend-badges">
                        ${prefersNights ? '<span class="badge night-badge">🌙 Nights</span>' : ''}
                        ${isSamaritan ? '<span class="badge samaritan-badge">😇 Samaritan</span>' : ''}
                    </div>
                    ${note ? `<div class="friend-note">${note}</div>` : ''}
                </div>
                <button onclick="removeFriend('${friend.replace(/'/g, "\\'")}')">Remove</button>
            </div>
        `;
    }).join('');

    document.getElementById('friends-current').innerHTML = html || '<p class="no-data">No friends added yet</p>';

    // Populate dropdown
    const residents = getAllResidents();
    const select = document.getElementById('new-friend-select');
    select.innerHTML = '<option value="">Select a resident...</option>' +
        residents.map(name => `<option value="${name}">${name}</option>`).join('');
}

window.removeFriend = function(name) {
    if (!confirm(`Remove ${name} from friends?`)) return;

    const friendsData = getFriends();
    friendsData.friends = friendsData.friends.filter(f => f !== name);
    delete friendsData.notes[name];
    friendsData.prefers_nights = friendsData.prefers_nights.filter(f => f !== name);
    friendsData.good_samaritans = friendsData.good_samaritans.filter(f => f !== name);

    saveFriends(friendsData);
    renderFriendsList();
};

// Tab 7: Swap Ledger
function initLedgerTab() {
    renderLedger();

    document.getElementById('btn-add-debt').addEventListener('click', () => {
        const person = document.getElementById('debt-person').value;
        const direction = document.querySelector('input[name="debt-direction"]:checked').value;
        const shift = document.getElementById('debt-shift').value;
        const date = document.getElementById('debt-date').value;
        const notes = document.getElementById('debt-notes').value;

        if (!person || !shift || !date) {
            alert('Please fill in all required fields');
            return;
        }

        const ledger = getLedger();
        ledger.debts.push({
            person,
            direction, // 'owe_you' or 'you_owe'
            shift,
            date,
            notes,
            timestamp: new Date().toISOString()
        });

        saveLedger(ledger);
        renderLedger();

        // Clear form
        document.getElementById('debt-person').value = '';
        document.getElementById('debt-shift').value = '';
        document.getElementById('debt-date').value = '';
        document.getElementById('debt-notes').value = '';
    });
}

function renderLedger() {
    const ledger = getLedger();

    const oweYou = ledger.debts.filter(d => d.direction === 'owe_you');
    const youOwe = ledger.debts.filter(d => d.direction === 'you_owe');

    const renderDebts = (debts) => debts.map((debt, idx) => `
        <div class="debt-item">
            <div class="debt-header">
                <strong>${debt.person}</strong>
                <button onclick="clearDebt(${ledger.debts.indexOf(debt)})">Clear</button>
            </div>
            <div class="debt-details">
                <div>${debt.shift} on ${debt.date}</div>
                ${debt.notes ? `<div class="debt-note">${debt.notes}</div>` : ''}
            </div>
        </div>
    `).join('');

    document.getElementById('ledger-owes-me').innerHTML =
        renderDebts(oweYou) || '<p class="no-data">No one owes you</p>';

    document.getElementById('ledger-i-owe').innerHTML =
        renderDebts(youOwe) || '<p class="no-data">You don\'t owe anyone</p>';

    // Populate person dropdown
    const residents = getAllResidents();
    const select = document.getElementById('debt-person');
    select.innerHTML = '<option value="">Select a person...</option>' +
        residents.map(name => `<option value="${name}">${name}</option>`).join('');
}

window.clearDebt = function(idx) {
    if (!confirm('Clear this debt?')) return;

    const ledger = getLedger();
    ledger.debts.splice(idx, 1);
    saveLedger(ledger);
    renderLedger();
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Initialize user selector first
    initUserSelector();

    // Initialize tabs
    initTabs();

    // Initialize each tab's functionality
    initMyScheduleTab();
    initGoldenWeekendsTab();
    initTripPlannerTab();
    bindRotationOverrideHandlers();
    syncRotationOverridesUI();
    initWeekendSwapTab();
    initWhosFreeTab();
    initFriendsTab();
    initLedgerTab();

    // Update schedule info in footer
    const dateRange = getScheduleDateRange();
    document.getElementById('schedule-info').textContent =
        `${SCHEDULE.length} shifts from ${dateRange.start} to ${dateRange.end}`;

    // Data quality: show any unmapped CA shifts
    renderShiftAudit();
});

/**
 * Get the date range of the schedule
 */
function getScheduleDateRange() {
    if (SCHEDULE.length === 0) return { start: 'N/A', end: 'N/A' };

    const dates = SCHEDULE.map(s => s.date).sort();
    return {
        start: dates[0],
        end: dates[dates.length - 1]
    };
}
