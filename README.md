# QGenda Swap Finder

Static web app for anesthesia residents to find shift swap candidates. Open `index.html` in any browser - no server required.

## Features

- **My Schedule** - View upcoming shifts and metrics
- **Golden Weekends** - Find weekends where you and friends are off
- **Trip Planner** - Find coverage for vacation dates
- **Weekend Swap** - Find swap candidates with ease ratings
- **Holiday Swap** - Find resident/fellow coverage for holiday assignments
- **Assignments** - See assignments for residents not on call/day/ICU on a specific date
- **Friends List** - Manage preferred swap partners
- **Swap Ledger** - Track who owes whom (hidden by default)

## Quick Start

1. Export your schedule from QGenda as Excel (.xlsx)
2. Run `python convert-schedule.py schedule.xlsx` to generate schedule data
3. Open `index.html` in your browser
4. Select your name from the dropdown

## Updating Schedule

```bash
python convert-schedule.py schedule.xlsx
```

This extracts shifts and person types (from Excel row colors) into `js/schedule.js`.

## Files

```
index.html          - Main app UI
js/app.js           - UI logic and rendering
js/swap-finder.js   - Core swap-finding algorithms
js/schedule.js      - Generated schedule data
css/style.css       - Styling
convert-schedule.py - Excel to JS converter
```

## Person Types

Residents are classified by QGenda row colors:
- **CA-1** (Purple), **CA-2** (Blue), **CA-3** (Light blue)
- **Fellow** (Orange), **CRNA** (Yellow), **Faculty** (Grey)


## Checks

Run `npm test` for deterministic schedule-logic and UI-function regression tests (Node.js; no browser required).
Run `npm run ui-smoke` for Playwright browser checks after installing development dependencies and Playwright Chromium. The UI fixtures use a fixed date inside the bundled schedule so they remain reproducible as time passes.
An existing Chrome installation can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome`.


The current export covers November 9, 2026 through June 30, 2027. The converter uses the export's staff directory to preserve full names, retains unprefixed assignments for identified staff, and rejects empty imports without replacing existing data. It ignores schedule notes and contact-directory rows.

The converter requires `pandas` and `openpyxl`. With those installed, run `python3 -m unittest discover -s tests -p 'test_converter.py'` for import checks. Browser-free JavaScript checks also exercise the search engines against the bundled export.
