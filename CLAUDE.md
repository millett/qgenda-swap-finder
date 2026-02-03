# CLAUDE.md - QGenda Swap Finder

## Quick Context

Static HTML/JS app for anesthesia residents to find shift swap candidates. No build step, no server - just open `index.html` in browser.

## Architecture

```
index.html          - UI structure (tabs, forms, containers)
js/
  app.js            - UI logic, event handlers, rendering (~1200 lines)
  swap-finder.js    - Core algorithms (swap scoring, availability) (~800 lines)
  schedule.js       - Generated data: SCHEDULE array + PERSON_TYPES_DATA
css/style.css       - Styling (Pico CSS base + custom)
convert-schedule.py - Extracts data from QGenda Excel export
```

## Key Data Structures

**SCHEDULE** (in schedule.js): Array of shift objects
```js
{ date: "2025-02-01", name: "Millett, Matthew", shift: "CA OB Day" }
```

**PERSON_TYPES_DATA** (in schedule.js): Maps names to types
```js
{ "Smith, John": "ca2", "Anderson, Jason": "crna", ... }
```
Types: `intern`, `ca1`, `ca2`, `ca3`, `fellow`, `crna`, `faculty`, `resident`

## Person Type Logic

- `isResident(name)` - true for intern/ca1/ca2/ca3/resident
- `getPersonType(name)` - returns type string
- Types determined by Excel row colors + shift prefixes during convert

## Shift Categories (in swap-finder.js)

- `CALL_SHIFTS` - Night call (blocks availability)
- `DAY_SHIFTS` - Regular day shifts
- `UNAVAILABLE_SHIFTS` - ICU, vacation, etc.
- `NIGHT_CALL_SHIFTS` - Specifically night calls (affect next day)

## Main Features (Tabs)

1. **My Schedule** - Dashboard with metrics
2. **Golden Weekends** - Find weekends where user is off
3. **Trip Planner** - Find coverage for date ranges
4. **Weekend Swap** - Find swap partners with ease scoring
5. **Who's Free** - Check availability on a date
6. **Friends List** - Preferred swap partners (localStorage)

## Common Patterns

**Filtering by person type** (used in Trip Planner, Weekend Swap, Who's Free):
```js
filtered = filtered.filter(c => {
    if (isResident(c.name)) return true;
    if (getPersonType(c.name) === 'crna' && showCRNA) return true;
    if (getPersonType(c.name) === 'fellow') return true;
    return false;
});
```

**User data stored in localStorage** with user-specific keys:
- `qgenda_my_name` - Selected user
- `qgenda_friends_{username}` - Friends list
- `qgenda_ledger_{username}` - Swap ledger

## Updating Schedule Data

```bash
python convert-schedule.py schedule.xlsx
# Outputs js/schedule.js with SCHEDULE and PERSON_TYPES_DATA
```

## Swap Ease Scoring Logic

Located in `calculateSwapEase()` (swap-finder.js:283-340). Matrix based on what you offer vs ask for:

| You Have | They Have | Ease | Rationale |
|----------|-----------|------|-----------|
| Any | Vacation | Very Hard | Asking them to give up PTO |
| Same | Same | Easy | Equal trade |
| Night | Day | Easy if they prefer nights | They want what you have |
| Night | Day | Hard sell otherwise | Asking for an upgrade |
| Day | Night | Easy (unless they prefer nights) | Offering an upgrade |
| Night | Off | Moderate if they prefer nights | They might want it |
| Night | Off | Hard sell otherwise | Asking them to work |
| Off | Night | Easy (unless they prefer nights) | Taking their undesirable shift |
| Day | Off | Moderate | Asking for work, but only day |
| Off | Day | Easy | Taking their shift |

**Key nuance**: The "prefers nights" flag from Friends List flips ease for night-related swaps.

## Excel Color Extraction Gotchas

Known issues in `convert-schedule.py`:

1. **Cyan is shared**: `0000FFFF` used for both CA2s AND attendings - can't use color alone
2. **CRNAs can have CA shifts**: Must check CRNA colors (`00FFFF99`) even if `has_ca` is true
3. **Color format variations**: ARGB with/without alpha. Both `00FF9933` and `FFFF9933` = orange (intern)
4. **Unknown colors → "resident"**: If color doesn't match, defaults to `resident`. Script prints unknowns at end
5. **Cell-specific extraction**: Color grabbed from first row where person appears

**Verified color mappings:**
- Intern: Orange `00FF9933`
- CA1: Purple `009933FF`
- CA2: Cyan `0000FFFF`
- CA3: Teal `0099CCCC`
- CRNA: Yellow-green `00FFFF99`

## Shift Categories

Defined in swap-finder.js. Current sets:

**NIGHT_CALL_SHIFTS**: CLI Night Call, Senior Night Call, GOR1/GOR2 Night Call, Trauma Night Call, OB Night Call, PEDS Night Call, Liver Night Call

**CALL_SHIFTS**: All night calls + CLI Day Call

**DAY_SHIFTS**: GOR, GOR-Block, AMB, OB Day, PEDS, Pre-Op, Neuro, Liver, IR, CV, Thoracic, Uro, Trauma, GYN, ENT, Ortho, Spine, Vascular, Pain, Endoscopy, Dental, Plastics

**ICU_SHIFTS**: CTICU, SICU, ICU Call

**UNAVAILABLE_SHIFTS**: Vacation, Vacation Week, Sick, Conference, Post Call, Off, Holiday

**Potential gaps**: No CA Admin, CA Research, CA Education, CA Didactics shifts (if those exist)

**Edge case**: Code uses `.has()` for exact matches. A shift like "CA GOR (Modified)" won't match "CA GOR".

To audit existing shifts:
```bash
grep -o '"shift": "[^"]*"' js/schedule.js | sort | uniq -c | sort -rn
```

## Common Issues

- **CRNAs not showing**: Check `findCoverageCandidates()` includes CRNA shifts
- **Person type wrong**: Check PERSON_TYPES_DATA in schedule.js or Excel colors
- **Checkbox not working**: Verify checkbox ID matches in HTML and JS

## Testing

Open `index.html` in browser. No build step needed. Use browser devtools console for debugging.
