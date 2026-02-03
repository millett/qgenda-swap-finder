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

## Common Issues

- **CRNAs not showing**: Check `findCoverageCandidates()` includes CRNA shifts
- **Person type wrong**: Check PERSON_TYPES_DATA in schedule.js or Excel colors
- **Checkbox not working**: Verify checkbox ID matches in HTML and JS

## Testing

Open `index.html` in browser. No build step needed. Use browser devtools console for debugging.
