# QGenda Swap Rules

This document serves as the **source of truth** for all shift types and swap rules in the QGenda Swap Finder application. Reference this file when making any changes to swap logic in `swap-finder.js`.

---

## Shift Categories

### Night Call Shifts
**In-hospital overnight calls that require post-call day off.**

These shifts trigger automatic post-call conflict detection.

| Shift Name | Notes |
|------------|-------|
| CA CLI Night Call | Main OR night call |
| CA Senior Night Call | Senior resident call |
| CA GOR1 Night Call | GOR night call |
| CA GOR2 Night Call | GOR night call |
| CA CART Night Call | CART night call |
| CA CV Call | Cardiac call (limited qualified pool) |
| CA COMER Call | Comer hospital call |
| CA ICU Call | ICU overnight |
| CA Northshore Call | Northshore campus call |

### Call Shifts (All Types)
**All call shifts including night calls, day call, and home call.**

Includes everything in Night Call Shifts, plus:

| Shift Name | Notes |
|------------|-------|
| CA CLI Day Call | Daytime call (doesn't block next day) |
| CA GOR3 | 24-hour paid home call - very desirable |
| CA GOR4 | 24-hour paid home call - very desirable |

### Day Shifts
**Regular daytime clinical assignments.**

| Shift Name | Notes |
|------------|-------|
| CA GOR | General OR |
| CA GOR-Block | GOR block time |
| CA AMB | Ambulatory |
| CA AMB- Block | Ambulatory block |
| CA OB | OB anesthesia |
| CA OB3 | OB rotation |
| CA PEDS | Pediatrics |
| CA Ortho | Orthopedics |
| CA CTICU | CT ICU rotation |
| CA SICU | Surgical ICU rotation |
| CA CV Cardiac | Cardiac (day) |
| CA CV-3 | CV rotation |
| CA Neuro | Neuro anesthesia |
| CA Northshore | Northshore campus |
| CA Northshore Neuro | Northshore neuro |
| CA PACU | Post-anesthesia care |
| CA Pain Clinic | Pain clinic |
| CA Pain Clinic 3 | Pain clinic rotation |
| CA Urology | Urology cases |
| CA Vascular Thoracic | Vascular/thoracic |
| CA ECHO | Echo rotation |
| CA APMC | APMC rotation |
| CA APMC 3 | APMC rotation |
| CA Research | Research time |

### ICU Rotations (NOT Swappable)
**Assigned monthly rotations - cannot be traded.**

| Shift Name | Notes |
|------------|-------|
| CA CTICU | CT ICU rotation |
| CA SICU | Surgical ICU rotation |
| CA ICU Call | ICU call rotation |
| CA ICU 3 Elective | ICU elective |

> **Important**: ICU rotations are assigned in advance and are NOT eligible for swaps. The app filters these out automatically.

### Vacation/Unavailable Shifts
**Time off, excused absences, and status markers.**

| Shift Name | Notes |
|------------|-------|
| CA Vacation | Single vacation day |
| CA Vacation Week | Full vacation week |
| CA Sick | Sick day |
| CA Post Call | Post-call marker (not a real shift) |
| CA Home Post Call | Home call post-call marker |
| CA Excused | Excused absence |
| CA Interview | Interview day |
| CA Meeting | Meeting/administrative |
| CA half-day/meeting | Half day for meeting |

---

## Swap Eligibility Rules

### Who Can Swap With Whom
- **Residents** can swap with other residents
- **CRNAs** shown optionally (checkbox in UI)
- **Fellows** shown optionally (checkbox in UI)
- **Faculty/Attendings** are NOT shown in swap suggestions

### What CAN Be Swapped
- Night call shifts (with post-call conflict checks)
- Day call shifts
- Home call shifts (GOR3/GOR4 - but hard to get)
- Day shifts (for trip coverage, etc.)

### What CANNOT Be Swapped
- **ICU Rotations** (CTICU, SICU, ICU Call) - monthly assignments
- **Vacation** - generally very hard (shown with "Very hard" ease)
- **Post-call days** - not real shifts, just markers

### Post-Call Conflict Detection
When swapping night calls, the system checks:
1. If **you** take their night call, do you have work the next day?
2. If **they** take your night call, do they have work the next day?

If either person has a conflict, the swap is not shown.

**Shifts OK to have post-call** (don't count as conflicts):
- CA Post Call
- CA Home Post Call
- CA Vacation
- CA Vacation Week
- CA Sick
- CA Excused

---

## Swap Ease Scoring

The ease score predicts how difficult a swap negotiation will be.

### Ease Levels

| Level | Meaning |
|-------|---------|
| **Easy** | Fair trade or you're offering something better |
| **Moderate** | Slight imbalance, reasonable ask |
| **Hard sell** | You're asking for a favor |
| **Very hard** | Big ask (vacation, paid home call) |

### Basic Rules

| What You Have | What They Have | Ease | Why |
|---------------|----------------|------|-----|
| Same type | Same type | Easy | Equal trade |
| Night | Day | Hard sell | Asking for upgrade |
| Day | Night | Easy | Offering upgrade |
| Night | Off | Hard sell | Asking them to work |
| Off | Night | Easy | Taking their bad shift |
| Day | Off | Moderate | Asking for work (but just day) |
| Off | Day | Easy | Taking their shift |

### Special Cases

#### GOR3/GOR4 (Paid Home Call)
- **Always "Very hard"**
- These are paid shifts residents want to keep
- Asking someone to give up paid home call is a big ask

#### CV Call (Cardiac)
- **Always "Moderate"** minimum
- Limited pool of qualified residents
- Even "easy" trades are harder because fewer options

#### Vacation Shifts
- **Always "Very hard"**
- You're asking them to give up PTO
- Still shown in results but clearly marked

#### Night Preferences (from Friends List)
If someone is marked as "prefers nights":
- Offering them nights becomes **easier**
- Taking their nights becomes **harder**

| Scenario | Normal | If They Prefer Nights |
|----------|--------|----------------------|
| You: Night, They: Day | Hard sell | Easy |
| You: Day, They: Night | Easy | Hard sell |
| You: Night, They: Off | Hard sell | Moderate |
| You: Off, They: Night | Easy | Hard sell |

---

## How Features Use These Rules

### Weekend Swap Tab
1. Classifies your weekend as "night", "day", or "off"
2. Finds others' weekends in the search range
3. Filters out ICU rotations
4. Checks post-call conflicts both directions
5. Calculates ease based on weekend types
6. Sorts by ease (easiest first)

### Trip Planner Tab
1. Finds all your shifts in trip date range
2. Identifies which block travel (call shifts, day before night calls)
3. For each blocking shift, finds who could cover
4. Highlights "package deals" (one person covers multiple shifts)

### Who's Free Tab
1. Checks a specific date
2. Lists everyone without call/day/ICU shifts
3. Also checks night-before for post-call issues

---

## Adding New Shifts

When adding a new shift type to the schedule:

1. **Determine category**: Is it night call, day call, home call, day shift, or unavailable?

2. **Add to appropriate Set** in `swap-finder.js`:
   ```javascript
   // For night calls (trigger post-call)
   const NIGHT_CALL_SHIFTS = new Set([...existing..., 'CA New Night Call']);

   // For all call shifts
   const CALL_SHIFTS = new Set([...existing..., 'CA New Call']);

   // For day shifts
   const DAY_SHIFTS = new Set([...existing..., 'CA New Day Shift']);

   // For unavailable/off
   const UNAVAILABLE_SHIFTS = new Set([...existing..., 'CA New Unavailable']);
   ```

3. **Update this document** with the new shift

4. **Test**: Verify the shift appears correctly in swap suggestions

### Finding Unknown Shifts
To audit what shifts exist in the schedule data:
```bash
grep -o '"shift": "[^"]*"' js/schedule.js | sort | uniq -c | sort -rn
```

---

## Code Reference

All swap logic lives in `js/swap-finder.js`:

| Function | Line | Purpose |
|----------|------|---------|
| `hasPostCallConflict()` | ~224 | Check if night call creates conflict |
| `classifyWeekendType()` | ~264 | Categorize weekend as night/day/off |
| `calculateSwapEase()` | ~285 | Compute swap difficulty |
| `findSwapCandidates()` | ~367 | Find people to swap single shifts |
| `findWeekendSwap()` | ~490 | Find weekend swap partners |
| `findTripCoverage()` | ~688 | Find trip coverage options |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-02 | Initial documentation created |
