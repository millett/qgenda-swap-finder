/**
 * QGenda Shift Swap Finder - JavaScript Port
 *
 * Find optimal shift swaps for anesthesia residents.
 * Ported from Python swap_finder.py
 */

// ============================================================================
// CONSTANTS - Shift Categories
// ============================================================================

// Night call shifts that trigger post-call day (subset of CALL_SHIFTS that are actual night calls)
const NIGHT_CALL_SHIFTS = new Set([
  'CA CLI Night Call',
  'CA Senior Night Call',
  'CA GOR1 Night Call',
  'CA GOR2 Night Call',
  'CA CART Night Call',
  'CA CV Call',
  'CA COMER Call',
  'CA ICU Call',
  'CA Northshore Call',
]);

// Shift categories for swap eligibility
const CALL_SHIFTS = new Set([
  'CA CLI Day Call',
  'CA CLI Night Call',
  'CA Senior Night Call',
  'CA GOR1 Night Call',
  'CA GOR2 Night Call',
  'CA CART Night Call',
  'CA CV Call',
  'CA COMER Call',
  'CA ICU Call',
  'CA Northshore Call',
]);

// ICU rotations - cannot be swapped (assigned rotations, not tradeable shifts)
const ICU_SHIFTS = new Set([
  'CA CTICU',
  'CA SICU',
  'CA ICU Call',
  'CA ICU 3 Elective',
]);

// Vacation shifts - asymmetric handling (hard for them to give up, but I can offer to work)
const VACATION_SHIFTS = new Set([
  'CA Vacation',
  'CA Vacation Week',
]);

const DAY_SHIFTS = new Set([
  'CA GOR',
  'CA GOR-Block',
  'CA AMB',
  'CA AMB- Block',
  'CA OB',
  'CA OB3',
  'CA PEDS',
  'CA Ortho',
  'CA CTICU',
  'CA SICU',
  'CA CV Cardiac',
  'CA CV-3',
  'CA Neuro',
  'CA Northshore',
  'CA Northshore Neuro',
  'CA PACU',
  'CA Pain Clinic',
  'CA Pain Clinic 3',
  'CA Urology',
  'CA Vascular Thoracic',
  'CA ECHO',
  'CA APMC',
  'CA APMC 3',
  'CA Research',
]);

// Shifts that indicate unavailability
const UNAVAILABLE_SHIFTS = new Set([
  'CA Vacation',
  'CA Vacation Week',
  'CA Sick',
  'CA Post Call',
  'CA Home Post Call',
  'CA Excused',
  'CA Interview',
  'CA Meeting',
  'CA half-day/meeting',
]);

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Parse ISO date string "YYYY-MM-DD" to Date object
 * @param {string} str - Date string in YYYY-MM-DD format
 * @returns {Date}
 */
function parseDate(str) {
  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format Date object to ISO string "YYYY-MM-DD"
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format Date object for display as "Mon 02/01"
 * @param {Date} date
 * @returns {string}
 */
function formatDateDisplay(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = days[date.getDay()];
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${dayName} ${month}/${day}`;
}

/**
 * Add days to a date
 * @param {Date} date
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date}
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Get day of week (0=Sunday, 6=Saturday)
 * @param {Date} date
 * @returns {number}
 */
function getWeekday(date) {
  return date.getDay();
}

/**
 * Find the next Saturday from a given date
 * @param {Date} date
 * @returns {Date}
 */
function findNextSaturday(date) {
  const daysUntilSaturday = (6 - date.getDay() + 7) % 7;
  if (daysUntilSaturday === 0 && date.getDay() !== 6) {
    return addDays(date, 7);
  }
  return addDays(date, daysUntilSaturday);
}

/**
 * Check if two dates are the same day
 * @param {Date} date1
 * @param {Date} date2
 * @returns {boolean}
 */
function isSameDay(date1, date2) {
  return formatDate(date1) === formatDate(date2);
}

// ============================================================================
// SCHEDULE FILTERING UTILITIES
// ============================================================================

/**
 * Get all shifts for a person on a specific date
 * @param {Array} schedule - Global SCHEDULE array
 * @param {string} name - Person's name
 * @param {Date} date - Date to check
 * @returns {Array} Array of shift objects
 */
function getShiftsOnDate(schedule, name, date) {
  const dateStr = formatDate(date);
  return schedule.filter(s => s.name === name && s.date === dateStr);
}

/**
 * Check if two sets have any intersection
 * @param {Set} set1
 * @param {Set} set2
 * @returns {boolean}
 */
function setsIntersect(set1, set2) {
  for (const item of set1) {
    if (set2.has(item)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// CORE SWAP LOGIC
// ============================================================================

/**
 * Check if taking a night call would create a post-call conflict.
 *
 * A post-call conflict occurs when someone is scheduled to work the day
 * after a night call (post-call day should be off).
 *
 * @param {Array} schedule - Full schedule array (CA shifts only)
 * @param {string} name - Person's name to check
 * @param {Date} nightCallDate - Date of the night call (will check day after)
 * @returns {boolean} True if there's a conflict (person has shifts the day after)
 */
function hasPostCallConflict(schedule, name, nightCallDate) {
  const postCallDate = addDays(nightCallDate, 1);

  // Check if person has any shifts the day after
  const postCallShifts = getShiftsOnDate(schedule, name, postCallDate);

  if (postCallShifts.length === 0) {
    return false;
  }

  // Check what shifts they have - some shifts like Post Call or Vacation are OK
  const theirShifts = new Set(postCallShifts.map(s => s.shift));

  // These shifts are OK to have post-call (they're basically days off)
  const okPostCall = new Set([
    'CA Post Call',
    'CA Home Post Call',
    'CA Vacation',
    'CA Vacation Week',
    'CA Sick',
    'CA Excused',
  ]);

  // If they ONLY have OK shifts, no conflict
  const allOk = [...theirShifts].every(shift => okPostCall.has(shift));
  if (allOk) {
    return false;
  }

  // They have work shifts the day after - this is a conflict
  return true;
}

/**
 * Classify a weekend as 'night', 'day', or 'off'.
 *
 * @param {Set} satShifts - Set of shift names on Saturday
 * @param {Set} sunShifts - Set of shift names on Sunday
 * @returns {string} 'night' if any call shifts, 'day' if any day shifts, 'off' otherwise
 */
function classifyWeekendType(satShifts, sunShifts) {
  const allShifts = new Set([...satShifts, ...sunShifts]);

  if (setsIntersect(allShifts, CALL_SHIFTS)) {
    return 'night';
  } else if (setsIntersect(allShifts, DAY_SHIFTS)) {
    return 'day';
  }
  return 'off';
}

/**
 * Calculate how easy a swap would be to negotiate.
 *
 * @param {string} myType - My weekend type ('night', 'day', 'off')
 * @param {string} theirType - Their weekend type ('night', 'day', 'off')
 * @param {Set} prefersNights - Set of names who prefer night shifts
 * @param {string} candidate - Candidate name to check against prefersNights
 * @param {Set} theirShifts - Set of their actual shift names (to check for vacation)
 * @returns {string} Ease level: 'Easy', 'Moderate', 'Hard sell', or 'Very hard'
 */
function calculateSwapEase(myType, theirType, prefersNights = new Set(), candidate = null, theirShifts = new Set()) {
  // If THEY have vacation on their weekend, very hard sell
  // (asking them to give up vacation - still show them, but clearly marked)
  if (setsIntersect(theirShifts, VACATION_SHIFTS)) {
    return 'Very hard';
  }

  // If they prefer nights and have nights, taking them is actually harder
  // If they prefer nights and I'm offering nights, it's easier for them
  const candidatePreferNights = candidate ? prefersNights.has(candidate) : false;

  // Same type swaps are generally easy
  if (myType === theirType) {
    return 'Easy';
  }

  // I have night, they have day - I'm asking for an upgrade
  if (myType === 'night' && theirType === 'day') {
    if (candidatePreferNights) {
      return 'Easy'; // They want nights anyway
    }
    return 'Hard sell';
  }

  // I have day, they have night - I'm offering an upgrade
  if (myType === 'day' && theirType === 'night') {
    if (candidatePreferNights) {
      return 'Hard sell'; // They actually want their night
    }
    return 'Easy';
  }

  // Night <-> Off scenarios
  if (myType === 'night' && theirType === 'off') {
    if (candidatePreferNights) {
      return 'Moderate'; // They might want it
    }
    return 'Hard sell'; // Asking them to take on work
  }

  if (myType === 'off' && theirType === 'night') {
    if (candidatePreferNights) {
      return 'Hard sell'; // They want their night
    }
    return 'Easy'; // Offering to take their undesirable shift
  }

  // Day <-> Off scenarios
  if (myType === 'day' && theirType === 'off') {
    return 'Moderate'; // Asking them to work, but it's just day shift
  }

  if (myType === 'off' && theirType === 'day') {
    return 'Easy'; // Offering to take their shift
  }

  return 'Moderate';
}

/**
 * Find residents who could swap shifts.
 *
 * @param {Array} schedule - Full schedule array
 * @param {string} myName - Your name
 * @param {string|Date} myDate - Date of your shift to swap away
 * @param {string} myShift - Your shift type to swap away
 * @param {Object} options - Optional parameters
 * @param {Array} options.targetDateRange - [startDate, endDate] to find swaps
 * @param {string} options.targetShiftType - Specific shift type to swap for
 * @returns {Array} Array of potential swap candidates
 */
function findSwapCandidates(schedule, myName, myDate, myShift, options = {}) {
  const { targetDateRange, targetShiftType } = options;

  // Convert myDate to Date object if it's a string
  const myDateObj = typeof myDate === 'string' ? parseDate(myDate) : myDate;

  // Get all CA shifts
  const caSchedule = schedule.filter(s => s.shift && s.shift.startsWith('CA '));

  // Get all residents
  const allResidents = new Set(caSchedule.map(s => s.name));
  allResidents.delete(myName);

  const candidates = [];

  for (const resident of allResidents) {
    const residentShifts = caSchedule.filter(s => s.name === resident);

    // Check what they're doing on my_date
    const theirShiftOnMyDate = getShiftsOnDate(caSchedule, resident, myDateObj);

    // Skip if they're on call, post-call, or unavailable on my date
    if (theirShiftOnMyDate.length > 0) {
      const theirShifts = new Set(theirShiftOnMyDate.map(s => s.shift));
      const unavail = new Set([...CALL_SHIFTS, ...UNAVAILABLE_SHIFTS]);
      if (setsIntersect(theirShifts, unavail)) {
        continue;
      }
    }

    // Find what shifts they have that could be swapped
    let potentialSwaps;
    if (targetDateRange) {
      const [start, end] = targetDateRange.map(d => typeof d === 'string' ? parseDate(d) : d);
      potentialSwaps = residentShifts.filter(s => {
        const shiftDate = parseDate(s.date);
        return shiftDate >= start && shiftDate <= end;
      });
    } else {
      // Look within 2 weeks before and after
      const start = addDays(myDateObj, -14);
      const end = addDays(myDateObj, 14);
      potentialSwaps = residentShifts.filter(s => {
        const shiftDate = parseDate(s.date);
        return shiftDate >= start && shiftDate <= end;
      });
    }

    // Filter to matching shift types if specified
    if (targetShiftType) {
      potentialSwaps = potentialSwaps.filter(s =>
        s.shift.toLowerCase().includes(targetShiftType.toLowerCase())
      );
    } else if (CALL_SHIFTS.has(myShift)) {
      // If swapping call, find their call shifts
      potentialSwaps = potentialSwaps.filter(s => CALL_SHIFTS.has(s.shift));
    }

    for (const swap of potentialSwaps) {
      const swapDate = parseDate(swap.date);

      // Check if I'm available on their date
      const myShiftsThatDay = getShiftsOnDate(caSchedule, myName, swapDate);

      let available;
      if (myShiftsThatDay.length === 0) {
        available = true;
      } else {
        const myShiftTypes = new Set(myShiftsThatDay.map(s => s.shift));
        const unavail = new Set([...CALL_SHIFTS, ...UNAVAILABLE_SHIFTS]);
        available = !setsIntersect(myShiftTypes, unavail);
      }

      if (available) {
        // Check for post-call conflicts if we're swapping night calls
        let skipDueToPostCall = false;

        // Direction 1: If I take THEIR night call, do I have work the next day?
        if (NIGHT_CALL_SHIFTS.has(swap.shift)) {
          if (hasPostCallConflict(caSchedule, myName, swapDate)) {
            skipDueToPostCall = true;
          }
        }

        // Direction 2: If THEY take MY night call, do they have work the next day?
        if (NIGHT_CALL_SHIFTS.has(myShift)) {
          if (hasPostCallConflict(caSchedule, resident, myDateObj)) {
            skipDueToPostCall = true;
          }
        }

        if (!skipDueToPostCall) {
          candidates.push({
            candidate: resident,
            their_date: swapDate,
            their_shift: swap.shift,
            your_date: myDateObj,
            your_shift: myShift,
            you_available_their_date: available,
          });
        }
      }
    }
  }

  // Sort by their_date
  candidates.sort((a, b) => a.their_date - b.their_date);

  return candidates;
}

/**
 * Find someone to swap an entire weekend with.
 *
 * Shows ALL potential swaps (not just night-for-night), categorized by type.
 *
 * @param {Array} schedule - Full schedule array
 * @param {string} myName - Your name
 * @param {Array} weekendDates - [Saturday, Sunday] dates to swap
 * @param {number} lookBackWeeks - How many weeks back to look
 * @param {number} lookForwardWeeks - How many weeks forward to look
 * @returns {Array} Array of potential weekend swaps
 */
function findWeekendSwap(schedule, myName, weekendDates, lookBackWeeks = 4, lookForwardWeeks = 4) {
  // Convert dates to Date objects if needed
  const [mySat, mySun] = weekendDates.map(d => typeof d === 'string' ? parseDate(d) : d);

  const caSchedule = schedule.filter(s => s.shift && s.shift.startsWith('CA '));

  // Get friends data
  const friends = getFriends();
  const prefersNights = new Set(friends.prefers_nights || []);

  // Get my shifts on the weekend
  const mySatShifts = getShiftsOnDate(caSchedule, myName, mySat);
  const mySunShifts = getShiftsOnDate(caSchedule, myName, mySun);

  const mySatShiftSet = new Set(mySatShifts.map(s => s.shift));
  const mySunShiftSet = new Set(mySunShifts.map(s => s.shift));
  const myWeekendType = classifyWeekendType(mySatShiftSet, mySunShiftSet);

  // Get all residents
  const allResidents = new Set(caSchedule.map(s => s.name));
  allResidents.delete(myName);

  const candidates = [];

  // Generate weekend date pairs to check
  const startCheck = addDays(mySat < mySun ? mySat : mySun, -lookBackWeeks * 7);
  const endCheck = addDays(mySat > mySun ? mySat : mySun, lookForwardWeeks * 7);

  let current = startCheck;
  while (current <= endCheck) {
    // Find Saturday
    const saturday = findNextSaturday(current);
    const sunday = addDays(saturday, 1);

    // Skip if this is my weekend
    if (isSameDay(saturday, mySat)) {
      current = addDays(current, 7);
      continue;
    }

    if (saturday < startCheck || sunday > endCheck) {
      current = addDays(current, 7);
      continue;
    }

    // Check each resident's shifts on this weekend
    for (const resident of allResidents) {
      const residentSat = getShiftsOnDate(caSchedule, resident, saturday);
      const residentSun = getShiftsOnDate(caSchedule, resident, sunday);

      const satShifts = new Set(residentSat.map(s => s.shift));
      const sunShifts = new Set(residentSun.map(s => s.shift));

      // Skip if they have ICU on their own weekend (ICU rotations can't be swapped)
      const theirWeekendShifts = new Set([...satShifts, ...sunShifts]);
      if (setsIntersect(theirWeekendShifts, ICU_SHIFTS)) {
        continue;
      }

      // Classify their weekend type
      const theirWeekendType = classifyWeekendType(satShifts, sunShifts);

      // Check if they're available on MY weekend
      const theirShiftsMySat = getShiftsOnDate(caSchedule, resident, mySat);
      const theirShiftsMySun = getShiftsOnDate(caSchedule, resident, mySun);

      const theirSat = new Set(theirShiftsMySat.map(s => s.shift));
      const theirSun = new Set(theirShiftsMySun.map(s => s.shift));

      // Skip if they have ICU on my weekend
      const theirShiftsMyWeekend = new Set([...theirSat, ...theirSun]);
      if (setsIntersect(theirShiftsMyWeekend, ICU_SHIFTS)) {
        continue;
      }

      // Are they free/available on my weekend?
      const unavail = new Set([...CALL_SHIFTS, ...UNAVAILABLE_SHIFTS]);
      const availableMyWeekend = !setsIntersect(theirShiftsMyWeekend, unavail);

      // Am I available on THEIR weekend?
      const myShiftsTheirSat = getShiftsOnDate(caSchedule, myName, saturday);
      const myShiftsTheirSun = getShiftsOnDate(caSchedule, myName, sunday);

      const mySatOnTheirs = new Set(myShiftsTheirSat.map(s => s.shift));
      const mySunOnTheirs = new Set(myShiftsTheirSun.map(s => s.shift));

      // Skip if I have ICU on their weekend
      const myShiftsTheirWeekend = new Set([...mySatOnTheirs, ...mySunOnTheirs]);
      if (setsIntersect(myShiftsTheirWeekend, ICU_SHIFTS)) {
        continue;
      }

      const iAmAvailableTheirWeekend = !setsIntersect(myShiftsTheirWeekend, unavail);

      // Both must be available for a valid swap
      if (availableMyWeekend && iAmAvailableTheirWeekend) {
        // Check for post-call conflicts
        let skipDueToPostCall = false;

        // Check their weekend night calls (I would be taking them)
        const theirNightCalls = [...theirWeekendShifts].filter(s => NIGHT_CALL_SHIFTS.has(s));
        for (const theirShift of theirNightCalls) {
          if (satShifts.has(theirShift)) {
            if (hasPostCallConflict(caSchedule, myName, saturday)) {
              skipDueToPostCall = true;
              break;
            }
          }
          if (sunShifts.has(theirShift)) {
            if (hasPostCallConflict(caSchedule, myName, sunday)) {
              skipDueToPostCall = true;
              break;
            }
          }
        }

        // Check my weekend night calls (they would be taking them)
        if (!skipDueToPostCall) {
          const myWeekendShifts = new Set([...mySatShiftSet, ...mySunShiftSet]);
          const myNightCalls = [...myWeekendShifts].filter(s => NIGHT_CALL_SHIFTS.has(s));
          for (const myShift of myNightCalls) {
            if (mySatShiftSet.has(myShift)) {
              if (hasPostCallConflict(caSchedule, resident, mySat)) {
                skipDueToPostCall = true;
                break;
              }
            }
            if (mySunShiftSet.has(myShift)) {
              if (hasPostCallConflict(caSchedule, resident, mySun)) {
                skipDueToPostCall = true;
                break;
              }
            }
          }
        }

        if (skipDueToPostCall) {
          continue;
        }

        // Calculate swap type and ease
        const swapType = `${capitalize(myWeekendType)}↔${capitalize(theirWeekendType)}`;
        const ease = calculateSwapEase(
          myWeekendType,
          theirWeekendType,
          prefersNights,
          resident,
          theirWeekendShifts
        );

        candidates.push({
          candidate: resident,
          their_weekend: `Sat ${formatDateDisplay(saturday).split(' ')[1]} - Sun ${formatDateDisplay(sunday).split(' ')[1]}`,
          their_sat_shift: satShifts.size > 0 ? [...satShifts].join(', ') : 'OFF',
          their_sun_shift: sunShifts.size > 0 ? [...sunShifts].join(', ') : 'OFF',
          swap_type: swapType,
          ease: ease,
          available_your_weekend: availableMyWeekend,
          saturday: saturday,
          sunday: sunday,
        });
      }
    }

    current = addDays(current, 7);
  }

  // Sort by weekend (chronologically), then by ease
  const easeOrder = { 'Easy': 0, 'Moderate': 1, 'Hard sell': 2, 'Very hard': 3 };
  candidates.sort((a, b) => {
    if (a.saturday.getTime() !== b.saturday.getTime()) {
      return a.saturday - b.saturday;
    }
    return (easeOrder[a.ease] || 1) - (easeOrder[b.ease] || 1);
  });

  return candidates;
}

/**
 * Find all shifts that need coverage for a trip and suggest swap packages.
 *
 * @param {Array} schedule - Full schedule array
 * @param {string} myName - Your name
 * @param {string|Date} tripStart - First day of trip
 * @param {string|Date} tripEnd - Last day of trip
 * @param {boolean} departDayBefore - If true, night calls the day before trip start also need coverage
 * @returns {Object} Object with blocking_shifts, candidates_by_shift, and package_recommendations
 */
function findTripCoverage(schedule, myName, tripStart, tripEnd, departDayBefore = false) {
  const start = typeof tripStart === 'string' ? parseDate(tripStart) : tripStart;
  const end = typeof tripEnd === 'string' ? parseDate(tripEnd) : tripEnd;

  const caSchedule = schedule.filter(s => s.shift && s.shift.startsWith('CA '));

  // Find the date range of the user's schedule data
  const myAllShifts = caSchedule.filter(s => s.name === myName);
  let scheduleStart = null;
  let scheduleEnd = null;

  if (myAllShifts.length > 0) {
    const dates = myAllShifts.map(s => parseDate(s.date)).sort((a, b) => a - b);
    scheduleStart = dates[0];
    scheduleEnd = dates[dates.length - 1];
  }

  // Check if trip dates are outside the schedule data range
  let dataWarning = null;
  if (scheduleEnd && end > scheduleEnd) {
    dataWarning = {
      type: 'incomplete_data',
      message: `Schedule data for ${myName} only extends through ${formatDate(scheduleEnd)}. Dates after this are not covered.`,
      scheduleEnd: scheduleEnd
    };
  } else if (scheduleStart && start < scheduleStart) {
    dataWarning = {
      type: 'incomplete_data',
      message: `Schedule data for ${myName} starts on ${formatDate(scheduleStart)}. Dates before this are not covered.`,
      scheduleStart: scheduleStart
    };
  }

  // Expand range if departing day before
  const checkStart = departDayBefore ? addDays(start, -1) : start;

  // Find all your shifts in the range
  const myShifts = [];
  let current = checkStart;
  while (current <= end) {
    const shiftsOnDay = getShiftsOnDate(caSchedule, myName, current);
    shiftsOnDay.forEach(s => myShifts.push({ ...s, dateObj: parseDate(s.date) }));
    current = addDays(current, 1);
  }

  if (myShifts.length === 0) {
    return {
      blocking_shifts: [],
      candidates_by_shift: {},
      package_recommendations: [],
      data_warning: dataWarning
    };
  }

  // Categorize blocking shifts
  const blockingShifts = [];
  for (const shiftRecord of myShifts) {
    const shift = shiftRecord.shift;
    const date = shiftRecord.dateObj;

    // Night calls always block travel
    let blocksTravel = CALL_SHIFTS.has(shift);

    // Day before trip: only night calls block
    if (date < start) {
      blocksTravel = shift.includes('Night');
    }

    blockingShifts.push({
      date: date,
      shift: shift,
      blocks_travel: blocksTravel,
      reason: shift.includes('Night') ? 'Night call prevents travel' :
              (CALL_SHIFTS.has(shift) ? 'Call shift' : 'Day shift during trip')
    });
  }

  // Find candidates for each blocking shift
  const candidatesByShift = {};
  const allCandidatesSet = new Set();

  for (const shiftInfo of blockingShifts) {
    if (!shiftInfo.blocks_travel) {
      continue;
    }

    const dateStr = formatDate(shiftInfo.date);
    const shift = shiftInfo.shift;

    const candidates = findSwapCandidates(
      caSchedule,
      myName,
      shiftInfo.date,
      shift
    );

    if (candidates.length > 0) {
      const key = `${dateStr} (${shift})`;
      candidatesByShift[key] = candidates;
      candidates.forEach(c => allCandidatesSet.add(c.candidate));
    }
  }

  // Find people who could cover multiple shifts (package deals)
  // Group by DATE (not individual shifts) to avoid counting same day multiple times
  const packageRecommendations = [];
  if (Object.keys(candidatesByShift).length > 1) {
    const candidateCoverage = {};

    for (const [shiftKey, candidates] of Object.entries(candidatesByShift)) {
      // Extract date from shiftKey (format: "2026-04-28 (CA CART Night Call)")
      const dateStr = shiftKey.split(' (')[0];

      for (const candidate of candidates) {
        if (!candidateCoverage[candidate.candidate]) {
          candidateCoverage[candidate.candidate] = { dates: new Set(), shifts: [] };
        }
        candidateCoverage[candidate.candidate].dates.add(dateStr);
        candidateCoverage[candidate.candidate].shifts.push(shiftKey);
      }
    }

    // Sort by number of unique DATES they can cover (not total shifts)
    const packages = Object.entries(candidateCoverage)
      .map(([candidate, data]) => ({
        candidate,
        can_cover: [...data.dates].sort(),  // Show unique dates
        coverage_count: data.dates.size      // Count unique dates
      }))
      .filter(pkg => pkg.coverage_count > 1)
      .sort((a, b) => b.coverage_count - a.coverage_count);

    packageRecommendations.push(...packages);
  }

  return {
    blocking_shifts: blockingShifts,
    candidates_by_shift: candidatesByShift,
    package_recommendations: packageRecommendations,
    data_warning: dataWarning
  };
}

/**
 * Find weekends where you AND friends are completely off.
 *
 * @param {Array} schedule - Full schedule array
 * @param {string} myName - Your name
 * @param {number} lookForwardWeeks - How many weeks to look forward
 * @returns {Array} Array of golden weekends
 */
function findGoldenWeekends(schedule, myName, lookForwardWeeks = 12) {
  const caSchedule = schedule.filter(s => s.shift && s.shift.startsWith('CA '));
  const friends = getFriends();
  const friendsSet = new Set(friends.friends || []);

  // Get date range
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addDays(today, lookForwardWeeks * 7);

  // Generate all weekend date pairs in range
  const weekends = [];
  let current = today;
  while (current <= endDate) {
    const saturday = findNextSaturday(current);
    const sunday = addDays(saturday, 1);

    if (saturday > endDate) {
      break;
    }

    weekends.push({ saturday, sunday });
    current = addDays(saturday, 7);
  }

  const results = [];

  for (const { saturday, sunday } of weekends) {
    // Check if I'm off
    const myShifts = [...getShiftsOnDate(caSchedule, myName, saturday),
                      ...getShiftsOnDate(caSchedule, myName, sunday)];
    const myShiftTypes = new Set(myShifts.map(s => s.shift));

    // I'm "off" if I have no shifts OR only vacation/excused type shifts
    const offCompatible = new Set([
      'CA Vacation',
      'CA Vacation Week',
      'CA Post Call',
      'CA Home Post Call',
      'CA Excused'
    ]);
    const iAmOff = myShiftTypes.size === 0 || [...myShiftTypes].every(s => offCompatible.has(s));

    // Check which residents are off
    const friendsOff = [];
    const residentsOffList = [];

    const allResidents = new Set(caSchedule.map(s => s.name));
    allResidents.delete(myName);

    for (const resident of allResidents) {
      const theirShifts = [...getShiftsOnDate(caSchedule, resident, saturday),
                           ...getShiftsOnDate(caSchedule, resident, sunday)];
      const theirShiftTypes = new Set(theirShifts.map(s => s.shift));

      // They're "off" if no work/call shifts
      const busyShifts = new Set([...CALL_SHIFTS, ...DAY_SHIFTS]);
      const isOff = !setsIntersect(theirShiftTypes, busyShifts);

      if (isOff) {
        residentsOffList.push(resident);
        if (friendsSet.has(resident)) {
          friendsOff.push(resident);
        }
      }
    }

    results.push({
      weekend: `Sat ${formatDateDisplay(saturday).split(' ')[1]} - Sun ${formatDateDisplay(sunday).split(' ')[1]}`,
      saturday: saturday,
      sunday: sunday,
      i_am_off: iAmOff,
      friends_off: friendsOff,
      friends_off_count: friendsOff.length,
      all_residents_off: residentsOffList,
      all_residents_off_count: residentsOffList.length,
    });
  }

  // Sort chronologically (next golden weekend first)
  results.sort((a, b) => a.saturday - b.saturday);

  return results;
}

/**
 * Get summary statistics for my upcoming schedule.
 *
 * @param {Array} schedule - Full schedule array
 * @param {string} myName - Your name
 * @param {number} daysAhead - Days to look ahead
 * @returns {Object} Object with upcoming_shifts, stats, and weekly_breakdown
 */
function getScheduleSummary(schedule, myName, daysAhead = 30) {
  const caSchedule = schedule.filter(s => s.shift && s.shift.startsWith('CA '));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addDays(today, daysAhead);

  // Get my shifts in range
  const myShifts = [];
  let current = today;
  while (current <= endDate) {
    const shiftsOnDay = getShiftsOnDate(caSchedule, myName, current);
    shiftsOnDay.forEach(s => {
      const dateObj = parseDate(s.date);
      myShifts.push({
        date: dateObj,
        shift: s.shift,
        shift_type: classifyShift(s.shift),
        days_until: Math.floor((dateObj - today) / (1000 * 60 * 60 * 24))
      });
    });
    current = addDays(current, 1);
  }

  // Sort by date
  myShifts.sort((a, b) => a.date - b.date);

  // Calculate stats
  const totalCalls = myShifts.filter(s => s.shift_type === 'call').length;
  const totalDayShifts = myShifts.filter(s => s.shift_type === 'day').length;

  // Count days off
  let daysOff = 0;
  current = today;
  while (current <= endDate) {
    const dayShifts = myShifts.filter(s => isSameDay(s.date, current));
    if (dayShifts.length === 0) {
      daysOff++;
    } else if (dayShifts.every(s => s.shift_type === 'off')) {
      daysOff++;
    }
    current = addDays(current, 1);
  }

  // Find next call
  let nextCall = null;
  const callShifts = myShifts.filter(s => s.shift_type === 'call');
  if (callShifts.length > 0) {
    nextCall = { date: callShifts[0].date, shift: callShifts[0].shift };
  }

  // Find next golden weekend
  let nextGoldenWeekend = null;
  const goldenWeekends = findGoldenWeekends(schedule, myName, 8);
  const myOffWeekends = goldenWeekends.filter(w => w.i_am_off);
  if (myOffWeekends.length > 0) {
    nextGoldenWeekend = myOffWeekends[0].saturday;
  }

  // Weekly breakdown
  const weeklyData = [];
  let currentWeek = new Date(today);
  currentWeek.setDate(currentWeek.getDate() - currentWeek.getDay() + 1); // Start of week (Monday)

  while (currentWeek <= endDate) {
    const weekEnd = addDays(currentWeek, 6);
    const weekShifts = myShifts.filter(s => s.date >= currentWeek && s.date <= weekEnd);

    const calls = weekShifts.filter(s => s.shift_type === 'call').length;
    const dayShifts = weekShifts.filter(s => s.shift_type === 'day').length;

    // Count off days in this week
    let weekOff = 0;
    let checkDate = new Date(Math.max(currentWeek, today));
    const weekEndCheck = new Date(Math.min(weekEnd, endDate));
    while (checkDate <= weekEndCheck) {
      const dayShiftsOnDate = weekShifts.filter(s => isSameDay(s.date, checkDate));
      if (dayShiftsOnDate.length === 0 || dayShiftsOnDate.every(s => s.shift_type === 'off')) {
        weekOff++;
      }
      checkDate = addDays(checkDate, 1);
    }

    weeklyData.push({
      week_of: formatDateDisplay(currentWeek).split(' ')[1],
      calls: calls,
      day_shifts: dayShifts,
      off_days: weekOff,
    });

    currentWeek = addDays(currentWeek, 7);
  }

  return {
    upcoming_shifts: myShifts,
    stats: {
      total_calls: totalCalls,
      total_day_shifts: totalDayShifts,
      days_off: daysOff,
      next_call: nextCall,
      next_golden_weekend: nextGoldenWeekend,
    },
    weekly_breakdown: weeklyData,
  };
}

/**
 * Generate a swap request message tailored to the situation.
 *
 * @param {string} candidateName - Candidate's name
 * @param {string} myShift - My shift
 * @param {string|Date} myDate - My date
 * @param {string} theirShift - Their shift
 * @param {string|Date} theirDate - Their date
 * @param {string} swapEase - Ease level ('Easy', 'Moderate', 'Hard sell', 'Very hard')
 * @param {string} swapType - Type of swap ('weekend', 'single', 'trip')
 * @returns {string} Swap message
 */
function generateSwapMessage(candidateName, myShift, myDate, theirShift, theirDate, swapEase = 'Moderate', swapType = 'weekend') {
  // Extract first name from "Last, First" format
  const firstName = candidateName.includes(', ') ?
    candidateName.split(', ')[1] : candidateName;

  const myDateStr = typeof myDate === 'string' ? myDate : formatDateDisplay(myDate);
  const theirDateStr = typeof theirDate === 'string' ? theirDate : formatDateDisplay(theirDate);

  if (swapEase === 'Easy') {
    if (swapType === 'weekend') {
      return `Hey ${firstName}! Would you want to swap weekends? I'd take your ${theirShift} on ${theirDateStr}, and you'd have my ${myShift} on ${myDateStr}. Let me know!`;
    } else {
      return `Hey ${firstName}! Would you want to swap shifts? I'd take your ${theirShift} on ${theirDateStr} for my ${myShift} on ${myDateStr}. Let me know!`;
    }
  } else if (swapEase === 'Moderate') {
    return `Hi ${firstName}, would you be open to a swap? I have ${myShift} on ${myDateStr} and saw you have ${theirShift} on ${theirDateStr}. I know it's not a perfect trade, but let me know if you'd consider it!`;
  } else if (swapEase === 'Hard sell') {
    return `Hey ${firstName}! I have a favor to ask - I'm trying to get ${myDateStr} off and noticed you have ${theirShift} that weekend. Would you consider swapping for my ${myShift} on ${theirDateStr}? Happy to owe you one!`;
  } else { // Very hard (vacation)
    return `${firstName}, I know this is a big ask since you have time off planned, but I'm in a bind for ${myDateStr}. Any chance you'd consider swapping your ${theirShift} for my ${myShift} on ${theirDateStr}? Totally understand if not!`;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Classify a shift type
 * @param {string} shift
 * @returns {string} 'call', 'day', 'off', or 'other'
 */
function classifyShift(shift) {
  if (CALL_SHIFTS.has(shift)) {
    return 'call';
  } else if (DAY_SHIFTS.has(shift)) {
    return 'day';
  } else if (UNAVAILABLE_SHIFTS.has(shift)) {
    return 'off';
  }
  return 'other';
}

/**
 * Capitalize first letter of a string
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// EXPORTS - Make functions available globally
// ============================================================================

// Export all functions to global scope
window.SwapFinder = {
  // Constants
  NIGHT_CALL_SHIFTS,
  CALL_SHIFTS,
  ICU_SHIFTS,
  VACATION_SHIFTS,
  DAY_SHIFTS,
  UNAVAILABLE_SHIFTS,

  // Date utilities
  parseDate,
  formatDate,
  formatDateDisplay,
  addDays,
  getWeekday,
  findNextSaturday,
  isSameDay,

  // Core functions
  hasPostCallConflict,
  classifyWeekendType,
  calculateSwapEase,
  findSwapCandidates,
  findWeekendSwap,
  findTripCoverage,
  findGoldenWeekends,
  getScheduleSummary,
  generateSwapMessage,

  // Helpers
  getShiftsOnDate,
  setsIntersect,
  classifyShift,
};
