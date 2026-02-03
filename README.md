# QGenda Swap Finder

Static web app for anesthesia residents to find shift swap candidates. Open `index.html` in any browser - no server required.

## Features

- **My Schedule** - View upcoming shifts and metrics
- **Golden Weekends** - Find weekends where you and friends are off
- **Trip Planner** - Find coverage for vacation dates
- **Weekend Swap** - Find swap candidates with ease ratings
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
