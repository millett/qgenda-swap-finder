#!/usr/bin/env python3
"""
QGenda Shift Swap Finder

Find optimal shift swaps for anesthesia residents.
"""

import argparse
import json
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional
import sys

# Night call shifts that trigger post-call day (subset of CALL_SHIFTS that are actual night calls)
NIGHT_CALL_SHIFTS = {
    'CA CLI Night Call',
    'CA Senior Night Call',
    'CA GOR1 Night Call', 'CA GOR2 Night Call',
    'CA CART Night Call', 'CA CV Call',
    'CA COMER Call', 'CA ICU Call',
    'CA Northshore Call',
}

# Config file paths
FRIENDS_FILE = Path(__file__).parent / 'friends.json'
LEDGER_FILE = Path(__file__).parent / 'swap_ledger.json'

# Shift categories for swap eligibility
CALL_SHIFTS = {
    'CA CLI Day Call', 'CA CLI Night Call',
    'CA Senior Night Call',
    'CA GOR1 Night Call', 'CA GOR2 Night Call',
    'CA CART Night Call', 'CA CV Call',
    'CA COMER Call', 'CA ICU Call',
    'CA Northshore Call',
}

# ICU rotations - cannot be swapped (assigned rotations, not tradeable shifts)
ICU_SHIFTS = {
    'CA CTICU', 'CA SICU', 'CA ICU Call', 'CA ICU 3 Elective',
}

# Vacation shifts - asymmetric handling (hard for them to give up, but I can offer to work)
VACATION_SHIFTS = {
    'CA Vacation', 'CA Vacation Week',
}

DAY_SHIFTS = {
    'CA GOR', 'CA GOR-Block', 'CA AMB', 'CA AMB- Block',
    'CA OB', 'CA OB3', 'CA PEDS', 'CA Ortho',
    'CA CTICU', 'CA SICU', 'CA CV Cardiac', 'CA CV-3',
    'CA Neuro', 'CA Northshore', 'CA Northshore Neuro',
    'CA PACU', 'CA Pain Clinic', 'CA Pain Clinic 3',
    'CA Urology', 'CA Vascular Thoracic', 'CA ECHO',
    'CA APMC', 'CA APMC 3', 'CA Research',
}

# Shifts that indicate unavailability
UNAVAILABLE_SHIFTS = {
    'CA Vacation', 'CA Vacation Week', 'CA Sick',
    'CA Post Call', 'CA Home Post Call', 'CA Excused',
    'CA Interview', 'CA Meeting', 'CA half-day/meeting',
}

# PGY levels (you'll need to maintain this mapping)
# For now, assume all residents are eligible unless specified
PGY_LEVELS = {
    # Add residents and their PGY levels here
    # 'Last, First': 4,  # Example
}

# Residents who have completed OB rotation (required for CLI call)
OB_COMPLETED = set()  # Add names as they complete OB


def has_post_call_conflict(
    schedule: pd.DataFrame,
    name: str,
    night_call_date,
) -> bool:
    """
    Check if taking a night call would create a post-call conflict.

    A post-call conflict occurs when someone is scheduled to work the day
    after a night call (post-call day should be off).

    Args:
        schedule: Full schedule DataFrame (CA shifts only)
        name: Person's name to check
        night_call_date: Date of the night call (will check day after)

    Returns:
        True if there's a conflict (person has shifts the day after)
    """
    night_call_date = pd.to_datetime(night_call_date)
    post_call_date = night_call_date + timedelta(days=1)

    # Check if person has any shifts the day after
    post_call_shifts = schedule[
        (schedule['name'] == name) &
        (schedule['date'] == post_call_date)
    ]

    if post_call_shifts.empty:
        return False

    # Check what shifts they have - some shifts like Post Call or Vacation are OK
    their_shifts = set(post_call_shifts['shift'].tolist())

    # These shifts are OK to have post-call (they're basically days off)
    ok_post_call = {
        'CA Post Call', 'CA Home Post Call',
        'CA Vacation', 'CA Vacation Week',
        'CA Sick', 'CA Excused',
    }

    # If they ONLY have OK shifts, no conflict
    if their_shifts.issubset(ok_post_call):
        return False

    # They have work shifts the day after - this is a conflict
    return True


def load_friends() -> dict:
    """Load friends list from config file.

    Returns dict with keys:
    - friends: list of friend names
    - notes: dict of friend -> note
    - prefers_nights: list of names who prefer night shifts (optional)
    """
    if FRIENDS_FILE.exists():
        with open(FRIENDS_FILE) as f:
            data = json.load(f)
            # Ensure backward compatibility
            if 'prefers_nights' not in data:
                data['prefers_nights'] = []
            return data
    return {"friends": [], "notes": {}, "prefers_nights": []}


def save_friends(data: dict):
    """Save friends list to config file."""
    with open(FRIENDS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def load_ledger() -> dict:
    """Load swap ledger from config file."""
    if LEDGER_FILE.exists():
        with open(LEDGER_FILE) as f:
            return json.load(f)
    return {"debts": []}


def save_ledger(data: dict):
    """Save swap ledger to config file."""
    with open(LEDGER_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def filter_by_friends(df: pd.DataFrame, candidate_col: str = 'candidate') -> pd.DataFrame:
    """Filter a DataFrame to only include friends."""
    friends_data = load_friends()
    friends = friends_data.get('friends', [])
    if not friends:
        print("Warning: No friends in friends.json")
        return df
    return df[df[candidate_col].isin(friends)]


def parse_qgenda_excel(file_path: Path) -> pd.DataFrame:
    """Parse QGenda Excel export into a clean DataFrame."""
    df = pd.read_excel(file_path, header=None)

    records = []
    current_dates = {}

    for idx, row in df.iterrows():
        # Check if this is a date header row
        try:
            if pd.notna(row[0]) and '202' in str(row[0]):
                for day_idx, col in enumerate([0, 2, 4, 6, 8, 10, 12]):
                    if pd.notna(row[col]):
                        try:
                            current_dates[day_idx] = pd.to_datetime(row[col])
                        except:
                            pass
                continue
        except:
            pass

        # Process data rows
        for day_idx, (name_col, shift_col) in enumerate([(0,1), (2,3), (4,5), (6,7), (8,9), (10,11), (12,13)]):
            if day_idx in current_dates and pd.notna(row[name_col]) and pd.notna(row[shift_col]):
                name = str(row[name_col]).strip()
                shift = str(row[shift_col]).strip()
                skip_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Printed']
                if name and shift and not any(s in name for s in skip_names):
                    records.append({
                        'date': current_dates[day_idx],
                        'name': name,
                        'shift': shift
                    })

    return pd.DataFrame(records)


def get_resident_schedule(schedule: pd.DataFrame, name: str) -> pd.DataFrame:
    """Get all shifts for a specific resident."""
    return schedule[schedule['name'].str.contains(name, case=False, na=False)]


def find_swap_candidates(
    schedule: pd.DataFrame,
    my_name: str,
    my_date: str,
    my_shift: str,
    target_date_range: Optional[tuple] = None,
    target_shift_type: Optional[str] = None,
) -> pd.DataFrame:
    """
    Find residents who could swap shifts.

    Args:
        schedule: Full schedule DataFrame
        my_name: Your name
        my_date: Date of your shift to swap away
        my_shift: Your shift type to swap away
        target_date_range: Optional (start, end) date range to find swaps
        target_shift_type: Optional specific shift type to swap for

    Returns:
        DataFrame of potential swap candidates
    """
    my_date = pd.to_datetime(my_date)

    # Get all residents (people with CA shifts)
    ca_schedule = schedule[schedule['shift'].str.startswith('CA ')]
    all_residents = set(ca_schedule['name'].unique())
    all_residents.discard(my_name)

    candidates = []

    for resident in all_residents:
        resident_shifts = ca_schedule[ca_schedule['name'] == resident]

        # Check what they're doing on my_date
        their_shift_on_my_date = resident_shifts[resident_shifts['date'] == my_date]

        # Skip if they're on call, post-call, or unavailable on my date
        if not their_shift_on_my_date.empty:
            their_shifts = set(their_shift_on_my_date['shift'].tolist())
            if their_shifts & (CALL_SHIFTS | UNAVAILABLE_SHIFTS):
                continue

        # Find what shifts they have that could be swapped
        if target_date_range:
            start, end = pd.to_datetime(target_date_range[0]), pd.to_datetime(target_date_range[1])
            potential_swaps = resident_shifts[
                (resident_shifts['date'] >= start) &
                (resident_shifts['date'] <= end)
            ]
        else:
            # Look within 2 weeks before and after
            start = my_date - timedelta(days=14)
            end = my_date + timedelta(days=14)
            potential_swaps = resident_shifts[
                (resident_shifts['date'] >= start) &
                (resident_shifts['date'] <= end)
            ]

        # Filter to matching shift types if specified
        if target_shift_type:
            potential_swaps = potential_swaps[
                potential_swaps['shift'].str.contains(target_shift_type, case=False, na=False)
            ]
        elif my_shift in CALL_SHIFTS:
            # If swapping call, find their call shifts
            potential_swaps = potential_swaps[potential_swaps['shift'].isin(CALL_SHIFTS)]

        for _, swap in potential_swaps.iterrows():
            # Check if I'm available on their date
            my_shifts_that_day = ca_schedule[
                (ca_schedule['name'] == my_name) &
                (ca_schedule['date'] == swap['date'])
            ]

            if my_shifts_that_day.empty:
                available = True
            else:
                my_shift_types = set(my_shifts_that_day['shift'].tolist())
                available = not bool(my_shift_types & (CALL_SHIFTS | UNAVAILABLE_SHIFTS))

            if available:
                # Check for post-call conflicts if we're swapping night calls
                # Direction 1: If I take THEIR night call, do I have work the next day?
                # Direction 2: If THEY take MY night call, do they have work the next day?
                skip_due_to_post_call = False

                if swap['shift'] in NIGHT_CALL_SHIFTS:
                    # I would take their night call - check if I have post-call conflict
                    if has_post_call_conflict(ca_schedule, my_name, swap['date']):
                        skip_due_to_post_call = True

                if my_shift in NIGHT_CALL_SHIFTS:
                    # They would take my night call - check if they have post-call conflict
                    if has_post_call_conflict(ca_schedule, resident, my_date):
                        skip_due_to_post_call = True

                if not skip_due_to_post_call:
                    candidates.append({
                        'candidate': resident,
                        'their_date': swap['date'],
                        'their_shift': swap['shift'],
                        'your_date': my_date,
                        'your_shift': my_shift,
                        'you_available_their_date': available,
                    })

    result = pd.DataFrame(candidates)
    if not result.empty:
        result = result.sort_values('their_date')
    return result


def classify_weekend_type(sat_shifts: set, sun_shifts: set) -> str:
    """
    Classify a weekend as 'night', 'day', or 'off'.

    Args:
        sat_shifts: Set of shift names on Saturday
        sun_shifts: Set of shift names on Sunday

    Returns:
        'night' if any call shifts, 'day' if any day shifts, 'off' otherwise
    """
    all_shifts = sat_shifts | sun_shifts
    if all_shifts & CALL_SHIFTS:
        return 'night'
    elif all_shifts & DAY_SHIFTS:
        return 'day'
    return 'off'


def calculate_swap_ease(
    my_type: str,
    their_type: str,
    prefers_nights: set = None,
    candidate: str = None,
    their_shifts: set = None,
) -> str:
    """
    Calculate how easy a swap would be to negotiate.

    Args:
        my_type: My weekend type ('night', 'day', 'off')
        their_type: Their weekend type ('night', 'day', 'off')
        prefers_nights: Set of names who prefer night shifts
        candidate: Candidate name to check against prefers_nights
        their_shifts: Set of their actual shift names (to check for vacation)

    Returns:
        Ease level: 'Easy', 'Moderate', 'Hard sell', or 'Very hard'
    """
    prefers_nights = prefers_nights or set()

    # If THEY have vacation on their weekend, very hard sell
    # (asking them to give up vacation - still show them, but clearly marked)
    if their_shifts and (their_shifts & VACATION_SHIFTS):
        return 'Very hard'

    # If they prefer nights and have nights, taking them is actually harder
    # If they prefer nights and I'm offering nights, it's easier for them
    candidate_prefers_nights = candidate in prefers_nights if candidate else False

    # Same type swaps are generally easy
    if my_type == their_type:
        return 'Easy'

    # I have night, they have day - I'm asking for an upgrade
    if my_type == 'night' and their_type == 'day':
        if candidate_prefers_nights:
            return 'Easy'  # They want nights anyway
        return 'Hard sell'

    # I have day, they have night - I'm offering an upgrade
    if my_type == 'day' and their_type == 'night':
        if candidate_prefers_nights:
            return 'Hard sell'  # They actually want their night
        return 'Easy'

    # Night <-> Off scenarios
    if my_type == 'night' and their_type == 'off':
        if candidate_prefers_nights:
            return 'Moderate'  # They might want it
        return 'Hard sell'  # Asking them to take on work

    if my_type == 'off' and their_type == 'night':
        if candidate_prefers_nights:
            return 'Hard sell'  # They want their night
        return 'Easy'  # Offering to take their undesirable shift

    # Day <-> Off scenarios
    if my_type == 'day' and their_type == 'off':
        return 'Moderate'  # Asking them to work, but it's just day shift

    if my_type == 'off' and their_type == 'day':
        return 'Easy'  # Offering to take their shift

    return 'Moderate'


def find_weekend_swap(
    schedule: pd.DataFrame,
    my_name: str,
    weekend_dates: list[str],
    look_back_weeks: int = 4,
    look_forward_weeks: int = 4,
) -> pd.DataFrame:
    """
    Find someone to swap an entire weekend with.

    Shows ALL potential swaps (not just night-for-night), categorized by type:
    - Night ↔ Night: Easiest swap (equally undesirable)
    - Day ↔ Day: Easy swap (equally desirable)
    - Night ↔ Day: Harder sell (asking for upgrade)
    - Night ↔ OFF: Hardest (they gain work)

    Args:
        schedule: Full schedule DataFrame
        my_name: Your name
        weekend_dates: List of dates (Sat, Sun) you want to swap
        look_back_weeks: How many weeks back to look for swaps
        look_forward_weeks: How many weeks forward to look

    Returns:
        DataFrame of potential weekend swaps with swap_type and ease columns
    """
    weekend_dates = [pd.to_datetime(d) for d in weekend_dates]
    ca_schedule = schedule[schedule['shift'].str.startswith('CA ')]

    # Load friends data to get prefers_nights
    friends_data = load_friends()
    prefers_nights = set(friends_data.get('prefers_nights', []))

    # Get my shifts on the weekend
    my_sat_shifts_df = ca_schedule[
        (ca_schedule['name'] == my_name) &
        (ca_schedule['date'] == weekend_dates[0])
    ]
    my_sun_shifts_df = ca_schedule[
        (ca_schedule['name'] == my_name) &
        (ca_schedule['date'] == weekend_dates[1])
    ]

    my_sat_shifts = set(my_sat_shifts_df['shift'].tolist()) if not my_sat_shifts_df.empty else set()
    my_sun_shifts = set(my_sun_shifts_df['shift'].tolist()) if not my_sun_shifts_df.empty else set()
    my_weekend_type = classify_weekend_type(my_sat_shifts, my_sun_shifts)

    print(f"\nYour shifts on {[d.strftime('%m/%d') for d in weekend_dates]}:")
    print(f"  Weekend type: {my_weekend_type.upper()}")
    for _, row in pd.concat([my_sat_shifts_df, my_sun_shifts_df]).iterrows():
        print(f"  {row['date'].strftime('%a %m/%d')}: {row['shift']}")

    # Find other weekends with any shifts (not just call)
    all_residents = set(ca_schedule['name'].unique())
    all_residents.discard(my_name)

    candidates = []

    # Generate weekend date pairs to check
    start_check = min(weekend_dates) - timedelta(weeks=look_back_weeks)
    end_check = max(weekend_dates) + timedelta(weeks=look_forward_weeks)

    current = start_check
    while current <= end_check:
        # Find Saturday
        days_until_saturday = (5 - current.weekday()) % 7
        saturday = current + timedelta(days=days_until_saturday)
        sunday = saturday + timedelta(days=1)

        if saturday in weekend_dates:
            current += timedelta(days=7)
            continue

        if saturday < start_check or sunday > end_check:
            current += timedelta(days=7)
            continue

        # Check each resident's shifts on this weekend
        for resident in all_residents:
            resident_sat = ca_schedule[
                (ca_schedule['name'] == resident) &
                (ca_schedule['date'] == saturday)
            ]
            resident_sun = ca_schedule[
                (ca_schedule['name'] == resident) &
                (ca_schedule['date'] == sunday)
            ]

            sat_shifts = set(resident_sat['shift'].tolist()) if not resident_sat.empty else set()
            sun_shifts = set(resident_sun['shift'].tolist()) if not resident_sun.empty else set()

            # Skip if they have ICU on their own weekend (ICU rotations can't be swapped)
            if (sat_shifts | sun_shifts) & ICU_SHIFTS:
                continue

            # Classify their weekend type
            their_weekend_type = classify_weekend_type(sat_shifts, sun_shifts)

            # Check if they're available on MY weekend (no call or unavailable shifts)
            their_shifts_my_sat = ca_schedule[
                (ca_schedule['name'] == resident) &
                (ca_schedule['date'] == weekend_dates[0])
            ]
            their_shifts_my_sun = ca_schedule[
                (ca_schedule['name'] == resident) &
                (ca_schedule['date'] == weekend_dates[1])
            ]

            their_sat = set(their_shifts_my_sat['shift'].tolist()) if not their_shifts_my_sat.empty else set()
            their_sun = set(their_shifts_my_sun['shift'].tolist()) if not their_shifts_my_sun.empty else set()

            # Skip if they have ICU on my weekend (can't take my shifts)
            if (their_sat | their_sun) & ICU_SHIFTS:
                continue

            # Are they free/available on my weekend?
            unavail = CALL_SHIFTS | UNAVAILABLE_SHIFTS
            available_my_weekend = not bool((their_sat | their_sun) & unavail)

            # Am I available on THEIR weekend? (must check both directions!)
            my_shifts_their_sat = ca_schedule[
                (ca_schedule['name'] == my_name) &
                (ca_schedule['date'] == saturday)
            ]
            my_shifts_their_sun = ca_schedule[
                (ca_schedule['name'] == my_name) &
                (ca_schedule['date'] == sunday)
            ]
            my_sat_on_theirs = set(my_shifts_their_sat['shift'].tolist()) if not my_shifts_their_sat.empty else set()
            my_sun_on_theirs = set(my_shifts_their_sun['shift'].tolist()) if not my_shifts_their_sun.empty else set()

            # Skip if I have ICU on their weekend (can't take their shifts)
            if (my_sat_on_theirs | my_sun_on_theirs) & ICU_SHIFTS:
                continue

            i_am_available_their_weekend = not bool((my_sat_on_theirs | my_sun_on_theirs) & unavail)

            # Both must be available for a valid swap
            if available_my_weekend and i_am_available_their_weekend:
                # Check for post-call conflicts
                # If either weekend has night calls, check that the recipient doesn't work the next day
                skip_due_to_post_call = False

                # Check their weekend night calls (I would be taking them)
                their_night_calls = (sat_shifts | sun_shifts) & NIGHT_CALL_SHIFTS
                for their_shift in their_night_calls:
                    # Find which day has this night call
                    if their_shift in sat_shifts:
                        if has_post_call_conflict(ca_schedule, my_name, saturday):
                            skip_due_to_post_call = True
                            break
                    if their_shift in sun_shifts:
                        if has_post_call_conflict(ca_schedule, my_name, sunday):
                            skip_due_to_post_call = True
                            break

                # Check my weekend night calls (they would be taking them)
                if not skip_due_to_post_call:
                    my_night_calls = (my_sat_shifts | my_sun_shifts) & NIGHT_CALL_SHIFTS
                    for my_shift in my_night_calls:
                        if my_shift in my_sat_shifts:
                            if has_post_call_conflict(ca_schedule, resident, weekend_dates[0]):
                                skip_due_to_post_call = True
                                break
                        if my_shift in my_sun_shifts:
                            if has_post_call_conflict(ca_schedule, resident, weekend_dates[1]):
                                skip_due_to_post_call = True
                                break

                if skip_due_to_post_call:
                    continue

                # Calculate swap type and ease (pass their shifts for vacation check)
                swap_type = f"{my_weekend_type.title()}↔{their_weekend_type.title()}"
                ease = calculate_swap_ease(
                    my_weekend_type, their_weekend_type, prefers_nights, resident,
                    their_shifts=sat_shifts | sun_shifts
                )

                candidates.append({
                    'candidate': resident,
                    'their_weekend': f"Sat {saturday.strftime('%m/%d')} - Sun {sunday.strftime('%m/%d')}",
                    'their_sat_shift': ', '.join(sat_shifts) if sat_shifts else 'OFF',
                    'their_sun_shift': ', '.join(sun_shifts) if sun_shifts else 'OFF',
                    'swap_type': swap_type,
                    'ease': ease,
                    'available_your_weekend': available_my_weekend,
                })

        current += timedelta(days=7)

    result = pd.DataFrame(candidates)

    # Sort by weekend (chronologically), then by ease
    if not result.empty:
        ease_order = {'Easy': 0, 'Moderate': 1, 'Hard sell': 2, 'Very hard': 3}
        result['_ease_order'] = result['ease'].map(ease_order)
        result = result.sort_values(['their_weekend', '_ease_order']).drop(columns=['_ease_order'])

    return result


def find_night_to_day_swap(
    schedule: pd.DataFrame,
    my_name: str,
    my_night_date: str,
    my_night_shift: str,
) -> pd.DataFrame:
    """
    Find someone who has a day shift on the same day and might swap for your night call.
    """
    my_date = pd.to_datetime(my_night_date)
    ca_schedule = schedule[schedule['shift'].str.startswith('CA ')]

    # Find people with day shifts that day
    day_shifts_that_day = ca_schedule[
        (ca_schedule['date'] == my_date) &
        (ca_schedule['shift'].isin(DAY_SHIFTS))
    ]

    candidates = []
    for _, row in day_shifts_that_day.iterrows():
        if row['name'] == my_name:
            continue

        # Check they're not also on call that night
        their_night_shifts = ca_schedule[
            (ca_schedule['name'] == row['name']) &
            (ca_schedule['date'] == my_date) &
            (ca_schedule['shift'].isin(CALL_SHIFTS))
        ]

        if their_night_shifts.empty:
            candidates.append({
                'candidate': row['name'],
                'their_shift': row['shift'],
                'your_shift': my_night_shift,
                'date': my_date.strftime('%Y-%m-%d'),
            })

    return pd.DataFrame(candidates)


def find_trip_coverage(
    schedule: pd.DataFrame,
    my_name: str,
    trip_start: str,
    trip_end: str,
    depart_day_before: bool = False,
) -> dict:
    """
    Find all shifts that need coverage for a trip and suggest swap packages.

    Args:
        schedule: Full schedule DataFrame
        my_name: Your name
        trip_start: First day of trip (YYYY-MM-DD)
        trip_end: Last day of trip (YYYY-MM-DD)
        depart_day_before: If True, night calls the day before trip start also need coverage

    Returns:
        dict with 'blocking_shifts', 'candidates_by_shift', and 'package_recommendations'
    """
    start = pd.to_datetime(trip_start)
    end = pd.to_datetime(trip_end)
    ca_schedule = schedule[schedule['shift'].str.startswith('CA ')]

    # Expand range if departing day before
    check_start = start - timedelta(days=1) if depart_day_before else start

    # Find all your shifts in the range
    my_shifts = ca_schedule[
        (ca_schedule['name'] == my_name) &
        (ca_schedule['date'] >= check_start) &
        (ca_schedule['date'] <= end)
    ].copy()

    if my_shifts.empty:
        return {
            'blocking_shifts': [],
            'candidates_by_shift': {},
            'package_recommendations': []
        }

    # Categorize blocking shifts
    blocking_shifts = []
    for _, row in my_shifts.iterrows():
        shift = row['shift']
        date = row['date']

        # Night calls always block travel
        blocks_travel = shift in CALL_SHIFTS

        # Day before trip: only night calls block
        if date < start:
            blocks_travel = 'Night' in shift

        blocking_shifts.append({
            'date': date,
            'shift': shift,
            'blocks_travel': blocks_travel,
            'reason': 'Night call prevents travel' if 'Night' in shift else ('Call shift' if shift in CALL_SHIFTS else 'Day shift during trip')
        })

    # Find candidates for each blocking shift
    candidates_by_shift = {}
    all_candidates = set()

    for shift_info in blocking_shifts:
        if not shift_info['blocks_travel']:
            continue

        date_str = shift_info['date'].strftime('%Y-%m-%d')
        shift = shift_info['shift']

        candidates = find_swap_candidates(
            ca_schedule, my_name, date_str, shift
        )

        if not candidates.empty:
            candidates_by_shift[f"{date_str} ({shift})"] = candidates
            all_candidates.update(candidates['candidate'].unique())

    # Find people who could cover multiple shifts (package deals)
    package_recommendations = []
    if len(candidates_by_shift) > 1:
        candidate_coverage = {}
        for shift_key, df in candidates_by_shift.items():
            for candidate in df['candidate'].unique():
                if candidate not in candidate_coverage:
                    candidate_coverage[candidate] = []
                candidate_coverage[candidate].append(shift_key)

        # Sort by number of shifts they can cover
        for candidate, shifts in sorted(candidate_coverage.items(), key=lambda x: -len(x[1])):
            if len(shifts) > 1:
                package_recommendations.append({
                    'candidate': candidate,
                    'can_cover': shifts,
                    'coverage_count': len(shifts)
                })

    return {
        'blocking_shifts': blocking_shifts,
        'candidates_by_shift': candidates_by_shift,
        'package_recommendations': package_recommendations
    }


def find_golden_weekends(
    schedule: pd.DataFrame,
    my_name: str,
    look_forward_weeks: int = 12,
    friends_only: bool = True,
) -> pd.DataFrame:
    """
    Find weekends where you AND friends are completely off.

    Returns DataFrame with columns:
    - weekend: "Sat MM/DD - Sun MM/DD"
    - saturday: date
    - sunday: date
    - i_am_off: bool
    - friends_off: list of friend names who are off
    - friends_off_count: int
    - all_residents_off_count: int (for context)
    """
    ca_schedule = schedule[schedule['shift'].str.startswith('CA ')]
    friends_data = load_friends()
    friends = set(friends_data.get('friends', []))

    # Get date range
    today = pd.Timestamp.now().normalize()
    end_date = today + timedelta(weeks=look_forward_weeks)

    # Generate all weekend date pairs in range
    weekends = []
    current = today
    while current <= end_date:
        # Find next Saturday
        days_until_saturday = (5 - current.weekday()) % 7
        if days_until_saturday == 0 and current.weekday() != 5:
            days_until_saturday = 7
        saturday = current + timedelta(days=days_until_saturday)
        sunday = saturday + timedelta(days=1)

        if saturday > end_date:
            break

        weekends.append((saturday, sunday))
        current = saturday + timedelta(days=7)

    results = []
    for saturday, sunday in weekends:
        # Check if I'm off (no work shifts on Sat or Sun)
        my_shifts = ca_schedule[
            (ca_schedule['name'] == my_name) &
            (ca_schedule['date'].isin([saturday, sunday]))
        ]

        my_shift_types = set(my_shifts['shift'].tolist()) if not my_shifts.empty else set()

        # I'm "off" if I have no shifts OR only vacation/excused type shifts
        off_compatible = {'CA Vacation', 'CA Vacation Week', 'CA Post Call', 'CA Home Post Call', 'CA Excused'}
        i_am_off = my_shift_types.issubset(off_compatible)

        # Check which friends are off
        friends_off = []
        all_residents_off = 0

        all_residents = set(ca_schedule['name'].unique())
        all_residents.discard(my_name)

        for resident in all_residents:
            their_shifts = ca_schedule[
                (ca_schedule['name'] == resident) &
                (ca_schedule['date'].isin([saturday, sunday]))
            ]

            their_shift_types = set(their_shifts['shift'].tolist()) if not their_shifts.empty else set()

            # They're "off" if no work/call shifts
            busy_shifts = CALL_SHIFTS | DAY_SHIFTS
            is_off = not bool(their_shift_types & busy_shifts)

            if is_off:
                all_residents_off += 1
                if resident in friends:
                    friends_off.append(resident)

        results.append({
            'weekend': f"Sat {saturday.strftime('%m/%d')} - Sun {sunday.strftime('%m/%d')}",
            'saturday': saturday,
            'sunday': sunday,
            'i_am_off': i_am_off,
            'friends_off': friends_off,
            'friends_off_count': len(friends_off),
            'all_residents_off_count': all_residents_off,
        })

    df = pd.DataFrame(results)
    # Sort by friends_off_count descending
    if not df.empty:
        df = df.sort_values('friends_off_count', ascending=False)
    return df


def get_schedule_summary(
    schedule: pd.DataFrame,
    my_name: str,
    days_ahead: int = 30,
) -> dict:
    """
    Get summary statistics for my upcoming schedule.

    Returns:
    {
        'upcoming_shifts': DataFrame (date, shift, shift_type, days_until),
        'stats': {
            'total_calls': int,
            'total_day_shifts': int,
            'days_off': int,
            'next_call': (date, shift) or None,
            'next_golden_weekend': date or None,
        },
        'weekly_breakdown': DataFrame (week_of, calls, day_shifts, off_days),
    }
    """
    ca_schedule = schedule[schedule['shift'].str.startswith('CA ')]
    today = pd.Timestamp.now().normalize()
    end_date = today + timedelta(days=days_ahead)

    # Get my shifts in range
    my_shifts = ca_schedule[
        (ca_schedule['name'] == my_name) &
        (ca_schedule['date'] >= today) &
        (ca_schedule['date'] <= end_date)
    ].copy()

    # Classify each shift
    def classify_shift(shift):
        if shift in CALL_SHIFTS:
            return 'call'
        elif shift in DAY_SHIFTS:
            return 'day'
        elif shift in UNAVAILABLE_SHIFTS:
            return 'off'
        return 'other'

    if not my_shifts.empty:
        my_shifts['shift_type'] = my_shifts['shift'].apply(classify_shift)
        my_shifts['days_until'] = (my_shifts['date'] - today).dt.days
        my_shifts = my_shifts.sort_values('date')

    # Calculate stats
    total_calls = len(my_shifts[my_shifts['shift_type'] == 'call']) if not my_shifts.empty else 0
    total_day_shifts = len(my_shifts[my_shifts['shift_type'] == 'day']) if not my_shifts.empty else 0

    # Count days off (days with no shifts or only off-type shifts)
    all_dates = pd.date_range(today, end_date, freq='D')
    days_off = 0
    for d in all_dates:
        day_shifts = my_shifts[my_shifts['date'] == d] if not my_shifts.empty else pd.DataFrame()
        if day_shifts.empty:
            days_off += 1
        elif set(day_shifts['shift_type'].tolist()).issubset({'off'}):
            days_off += 1

    # Find next call
    next_call = None
    if not my_shifts.empty:
        call_shifts = my_shifts[my_shifts['shift_type'] == 'call']
        if not call_shifts.empty:
            first_call = call_shifts.iloc[0]
            next_call = (first_call['date'], first_call['shift'])

    # Find next golden weekend (weekend where I'm off)
    next_golden_weekend = None
    golden_weekends = find_golden_weekends(schedule, my_name, look_forward_weeks=8, friends_only=False)
    if not golden_weekends.empty:
        my_off_weekends = golden_weekends[golden_weekends['i_am_off']]
        if not my_off_weekends.empty:
            next_golden_weekend = my_off_weekends.iloc[0]['saturday']

    # Weekly breakdown
    weekly_data = []
    current_week = today - timedelta(days=today.weekday())  # Start of current week (Monday)
    while current_week <= end_date:
        week_end = current_week + timedelta(days=6)
        week_shifts = my_shifts[
            (my_shifts['date'] >= current_week) &
            (my_shifts['date'] <= week_end)
        ] if not my_shifts.empty else pd.DataFrame()

        calls = len(week_shifts[week_shifts['shift_type'] == 'call']) if not week_shifts.empty else 0
        day_shifts = len(week_shifts[week_shifts['shift_type'] == 'day']) if not week_shifts.empty else 0

        # Count off days in this week
        week_off = 0
        for d in pd.date_range(current_week, min(week_end, end_date), freq='D'):
            if d < today:
                continue
            day_shifts_df = week_shifts[week_shifts['date'] == d] if not week_shifts.empty else pd.DataFrame()
            if day_shifts_df.empty or set(day_shifts_df['shift_type'].tolist()).issubset({'off'}):
                week_off += 1

        weekly_data.append({
            'week_of': current_week.strftime('%m/%d'),
            'calls': calls,
            'day_shifts': day_shifts,
            'off_days': week_off,
        })
        current_week += timedelta(days=7)

    return {
        'upcoming_shifts': my_shifts[['date', 'shift', 'shift_type', 'days_until']] if not my_shifts.empty else pd.DataFrame(),
        'stats': {
            'total_calls': total_calls,
            'total_day_shifts': total_day_shifts,
            'days_off': days_off,
            'next_call': next_call,
            'next_golden_weekend': next_golden_weekend,
        },
        'weekly_breakdown': pd.DataFrame(weekly_data),
    }


def generate_swap_message(
    candidate_name: str,
    my_shift: str,
    my_date: str,
    their_shift: str,
    their_date: str,
    swap_ease: str = 'Moderate',
    swap_type: str = 'weekend',  # 'weekend', 'single', 'trip'
) -> str:
    """
    Generate a swap request message tailored to the situation.

    Tone adjusts based on swap_ease:
    - Easy: Direct, casual
    - Moderate: Friendly, acknowledge trade-off
    - Hard sell: Lead with benefits for them
    - Very hard: Extra polite, acknowledge difficulty
    """
    # Extract first name from "Last, First" format
    first_name = candidate_name.split(', ')[-1] if ', ' in candidate_name else candidate_name

    if swap_ease == 'Easy':
        if swap_type == 'weekend':
            return (
                f"Hey {first_name}! Would you want to swap weekends? I'd take your {their_shift} "
                f"on {their_date}, and you'd have my {my_shift} on {my_date}. Let me know!"
            )
        else:
            return (
                f"Hey {first_name}! Would you want to swap shifts? I'd take your {their_shift} "
                f"on {their_date} for my {my_shift} on {my_date}. Let me know!"
            )

    elif swap_ease == 'Moderate':
        return (
            f"Hi {first_name}, would you be open to a swap? I have {my_shift} on {my_date} "
            f"and saw you have {their_shift} on {their_date}. I know it's not a perfect "
            f"trade, but let me know if you'd consider it!"
        )

    elif swap_ease == 'Hard sell':
        return (
            f"Hey {first_name}! I have a favor to ask - I'm trying to get {my_date} off and "
            f"noticed you have {their_shift} that weekend. Would you consider swapping "
            f"for my {my_shift} on {their_date}? Happy to owe you one!"
        )

    else:  # Very hard (vacation)
        return (
            f"{first_name}, I know this is a big ask since you have time off planned, but "
            f"I'm in a bind for {my_date}. Any chance you'd consider swapping your "
            f"{their_shift} for my {my_shift} on {their_date}? Totally understand if not!"
        )


def main():
    parser = argparse.ArgumentParser(description='Find shift swap candidates')
    parser.add_argument('--file', '-f', default='qgenda-schedule-2026ish.xlsx',
                        help='QGenda Excel export file')
    parser.add_argument('--name', '-n', default='Millett, Matthew',
                        help='Your name as it appears in QGenda')

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # My schedule command
    my_sched = subparsers.add_parser('my-schedule', help='Show your schedule')
    my_sched.add_argument('--start', help='Start date (YYYY-MM-DD)')
    my_sched.add_argument('--end', help='End date (YYYY-MM-DD)')

    # Find swap command
    swap = subparsers.add_parser('swap', help='Find swap candidates for a specific shift')
    swap.add_argument('date', help='Date of your shift (YYYY-MM-DD)')
    swap.add_argument('--shift', help='Your shift type (auto-detected if not specified)')
    swap.add_argument('--friends-only', action='store_true', help='Only show friends as candidates')

    # Weekend swap command
    weekend = subparsers.add_parser('weekend', help='Find weekend swap candidates')
    weekend.add_argument('saturday', help='Saturday date (YYYY-MM-DD)')
    weekend.add_argument('--weeks', type=int, default=4, help='Weeks to look back/forward')
    weekend.add_argument('--friends-only', action='store_true', help='Only show friends as candidates')

    # Night-to-day swap command
    night_day = subparsers.add_parser('night-to-day', help='Swap night call for day shift')
    night_day.add_argument('date', help='Date of your night call (YYYY-MM-DD)')
    night_day.add_argument('--friends-only', action='store_true', help='Only show friends as candidates')

    # Who's free command
    free = subparsers.add_parser('whos-free', help='See who is free on a date')
    free.add_argument('date', help='Date to check (YYYY-MM-DD)')
    free.add_argument('--friends-only', action='store_true', help='Only show friends')

    # Trip planning command
    trip = subparsers.add_parser('trip', help='Plan coverage for a trip')
    trip.add_argument('start', help='Trip start date (YYYY-MM-DD)')
    trip.add_argument('end', help='Trip end date (YYYY-MM-DD)')
    trip.add_argument('--depart-day-before', action='store_true',
                      help='Include night before trip start (need coverage for evening departure)')
    trip.add_argument('--friends-only', action='store_true', help='Only show friends as candidates')

    # Friends management command
    friends = subparsers.add_parser('friends', help='Manage friends list')
    friends_sub = friends.add_subparsers(dest='friends_action')
    friends_list = friends_sub.add_parser('list', help='List all friends')
    friends_add = friends_sub.add_parser('add', help='Add a friend')
    friends_add.add_argument('friend_name', help='Name to add (as in QGenda, e.g., "Last, First")')
    friends_add.add_argument('--note', help='Optional note about this friend')
    friends_remove = friends_sub.add_parser('remove', help='Remove a friend')
    friends_remove.add_argument('friend_name', help='Name to remove')

    # Ledger management command
    ledger = subparsers.add_parser('ledger', help='Track swap debts')
    ledger_sub = ledger.add_subparsers(dest='ledger_action')
    ledger_show = ledger_sub.add_parser('show', help='Show all debts')
    ledger_add = ledger_sub.add_parser('add', help='Add a debt')
    ledger_add.add_argument('person', help='Person name')
    ledger_add.add_argument('direction', choices=['owes_me', 'i_owe'], help='Who owes whom')
    ledger_add.add_argument('--shift', help='Shift type')
    ledger_add.add_argument('--date', help='Date of the shift')
    ledger_add.add_argument('--notes', help='Optional notes')
    ledger_clear = ledger_sub.add_parser('clear', help='Clear a debt')
    ledger_clear.add_argument('index', type=int, help='Debt index to clear (from "ledger show")')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Load schedule
    file_path = Path(args.file)
    if not file_path.exists():
        file_path = Path(__file__).parent.parent / args.file

    print(f"Loading schedule from {file_path}...")
    schedule = parse_qgenda_excel(file_path)
    ca_schedule = schedule[schedule['shift'].str.startswith('CA ')]
    print(f"Loaded {len(ca_schedule)} resident shift records\n")

    if args.command == 'my-schedule':
        my_shifts = get_resident_schedule(ca_schedule, args.name)
        if args.start:
            my_shifts = my_shifts[my_shifts['date'] >= args.start]
        if args.end:
            my_shifts = my_shifts[my_shifts['date'] <= args.end]

        print(f"Schedule for {args.name}:")
        print("-" * 50)
        for _, row in my_shifts.sort_values('date').iterrows():
            print(f"{row['date'].strftime('%a %m/%d')}: {row['shift']}")

    elif args.command == 'swap':
        date = pd.to_datetime(args.date)

        # Auto-detect shift if not specified
        if args.shift:
            shift = args.shift
        else:
            my_shifts = ca_schedule[
                (ca_schedule['name'] == args.name) &
                (ca_schedule['date'] == date)
            ]
            if my_shifts.empty:
                print(f"No shifts found for {args.name} on {args.date}")
                sys.exit(1)
            shift = my_shifts.iloc[0]['shift']

        print(f"Finding swap candidates for your {shift} on {args.date}...")
        candidates = find_swap_candidates(ca_schedule, args.name, args.date, shift)

        if args.friends_only and not candidates.empty:
            candidates = filter_by_friends(candidates)

        if candidates.empty:
            print("No swap candidates found.")
        else:
            print(f"\nFound {len(candidates)} potential swaps:")
            print(candidates.to_string(index=False))

    elif args.command == 'weekend':
        saturday = pd.to_datetime(args.saturday)
        sunday = saturday + timedelta(days=1)

        print(f"Finding weekend swap candidates for {saturday.strftime('%m/%d')}-{sunday.strftime('%m/%d')}...")
        candidates = find_weekend_swap(
            ca_schedule, args.name,
            [saturday, sunday],
            look_back_weeks=args.weeks,
            look_forward_weeks=args.weeks
        )

        if args.friends_only and not candidates.empty:
            candidates = filter_by_friends(candidates)

        if candidates.empty:
            print("\nNo weekend swap candidates found.")
        else:
            print(f"\nFound {len(candidates)} potential weekend swaps:")
            print(candidates.to_string(index=False))

    elif args.command == 'night-to-day':
        date = pd.to_datetime(args.date)

        # Find your night shift
        my_shifts = ca_schedule[
            (ca_schedule['name'] == args.name) &
            (ca_schedule['date'] == date) &
            (ca_schedule['shift'].isin(CALL_SHIFTS))
        ]

        if my_shifts.empty:
            print(f"No night call found for {args.name} on {args.date}")
            sys.exit(1)

        night_shift = my_shifts.iloc[0]['shift']
        print(f"Finding day-shift swaps for your {night_shift} on {args.date}...")

        candidates = find_night_to_day_swap(ca_schedule, args.name, args.date, night_shift)

        if args.friends_only and not candidates.empty:
            candidates = filter_by_friends(candidates)

        if candidates.empty:
            print("No day-shift swap candidates found.")
        else:
            print(f"\nFound {len(candidates)} residents with day shifts who could swap:")
            print(candidates.to_string(index=False))

    elif args.command == 'whos-free':
        date = pd.to_datetime(args.date)

        # Get all residents
        all_residents = set(ca_schedule['name'].unique())

        # Filter to friends if requested
        if args.friends_only:
            friends_data = load_friends()
            all_residents = all_residents & set(friends_data.get('friends', []))

        # Find who has no call/unavailable shifts that day
        busy_that_day = ca_schedule[
            (ca_schedule['date'] == date) &
            (ca_schedule['shift'].isin(CALL_SHIFTS | UNAVAILABLE_SHIFTS))
        ]['name'].unique()

        free_residents = sorted(all_residents - set(busy_that_day))

        print(f"Residents available on {date.strftime('%a %m/%d')}:")
        print("-" * 30)
        for name in free_residents:
            # Show what they ARE doing that day
            their_shifts = ca_schedule[
                (ca_schedule['name'] == name) &
                (ca_schedule['date'] == date)
            ]
            shifts = ', '.join(their_shifts['shift'].tolist()) if not their_shifts.empty else 'OFF'
            print(f"  {name}: {shifts}")

    elif args.command == 'trip':
        print(f"Planning coverage for trip: {args.start} to {args.end}")
        if args.depart_day_before:
            print("(Including night before for evening departure)")
        print()

        result = find_trip_coverage(
            ca_schedule, args.name,
            args.start, args.end,
            depart_day_before=args.depart_day_before
        )

        # Show blocking shifts
        print("=" * 60)
        print("YOUR SHIFTS DURING TRIP:")
        print("=" * 60)
        for shift in result['blocking_shifts']:
            if shift['blocks_travel']:
                print(f"  {shift['date'].strftime('%a %m/%d')}: {shift['shift']} ← NEED COVERAGE")
            else:
                print(f"  {shift['date'].strftime('%a %m/%d')}: {shift['shift']}")
            if shift['blocks_travel']:
                print(f"    -> {shift['reason']}")

        # Show package recommendations first (if any)
        if result['package_recommendations']:
            print()
            print("=" * 60)
            print("PACKAGE DEALS (people who can cover multiple shifts):")
            print("=" * 60)
            for pkg in result['package_recommendations']:
                if args.friends_only:
                    friends_data = load_friends()
                    if pkg['candidate'] not in friends_data.get('friends', []):
                        continue
                print(f"\n  {pkg['candidate']} can cover {pkg['coverage_count']} shifts:")
                for shift_key in pkg['can_cover']:
                    print(f"    - {shift_key}")

        # Show candidates by shift
        print()
        print("=" * 60)
        print("SWAP CANDIDATES BY SHIFT:")
        print("=" * 60)
        for shift_key, candidates in result['candidates_by_shift'].items():
            print(f"\n{shift_key}:")
            if args.friends_only:
                candidates = filter_by_friends(candidates)
            if candidates.empty:
                print("  No candidates found")
            else:
                for _, row in candidates.head(5).iterrows():
                    print(f"  - {row['candidate']}: has {row['their_shift']} on {row['their_date'].strftime('%m/%d')}")

    elif args.command == 'friends':
        friends_data = load_friends()

        if args.friends_action == 'list' or args.friends_action is None:
            print("Friends list:")
            print("-" * 40)
            for friend in friends_data.get('friends', []):
                note = friends_data.get('notes', {}).get(friend, '')
                note_str = f" - {note}" if note else ""
                print(f"  {friend}{note_str}")
            if not friends_data.get('friends'):
                print("  (empty)")

        elif args.friends_action == 'add':
            if args.friend_name not in friends_data['friends']:
                friends_data['friends'].append(args.friend_name)
                if args.note:
                    if 'notes' not in friends_data:
                        friends_data['notes'] = {}
                    friends_data['notes'][args.friend_name] = args.note
                save_friends(friends_data)
                print(f"Added {args.friend_name} to friends list")
            else:
                print(f"{args.friend_name} is already in friends list")

        elif args.friends_action == 'remove':
            if args.friend_name in friends_data['friends']:
                friends_data['friends'].remove(args.friend_name)
                if args.friend_name in friends_data.get('notes', {}):
                    del friends_data['notes'][args.friend_name]
                save_friends(friends_data)
                print(f"Removed {args.friend_name} from friends list")
            else:
                print(f"{args.friend_name} not found in friends list")

    elif args.command == 'ledger':
        ledger_data = load_ledger()

        if args.ledger_action == 'show' or args.ledger_action is None:
            print("Swap Ledger:")
            print("-" * 50)
            debts = ledger_data.get('debts', [])
            if not debts:
                print("  No debts recorded")
            else:
                owes_me = [d for d in debts if d['direction'] == 'owes_me']
                i_owe = [d for d in debts if d['direction'] == 'i_owe']

                if owes_me:
                    print("\nPeople who OWE YOU:")
                    for i, debt in enumerate(debts):
                        if debt['direction'] == 'owes_me':
                            idx = debts.index(debt)
                            shift_info = f"{debt.get('shift', '?')} on {debt.get('date', '?')}" if debt.get('shift') else ""
                            notes = f" ({debt['notes']})" if debt.get('notes') else ""
                            print(f"  [{idx}] {debt['person']}: {shift_info}{notes}")

                if i_owe:
                    print("\nPeople YOU OWE:")
                    for i, debt in enumerate(debts):
                        if debt['direction'] == 'i_owe':
                            idx = debts.index(debt)
                            shift_info = f"{debt.get('shift', '?')} on {debt.get('date', '?')}" if debt.get('shift') else ""
                            notes = f" ({debt['notes']})" if debt.get('notes') else ""
                            print(f"  [{idx}] {debt['person']}: {shift_info}{notes}")

        elif args.ledger_action == 'add':
            debt = {
                'person': args.person,
                'direction': args.direction,
            }
            if args.shift:
                debt['shift'] = args.shift
            if args.date:
                debt['date'] = args.date
            if args.notes:
                debt['notes'] = args.notes

            ledger_data['debts'].append(debt)
            save_ledger(ledger_data)

            direction_str = "owes you" if args.direction == 'owes_me' else "you owe"
            print(f"Added: {args.person} {direction_str}")

        elif args.ledger_action == 'clear':
            debts = ledger_data.get('debts', [])
            if 0 <= args.index < len(debts):
                removed = debts.pop(args.index)
                save_ledger(ledger_data)
                print(f"Cleared debt: {removed['person']}")
            else:
                print(f"Invalid index {args.index}. Use 'ledger show' to see valid indices.")


if __name__ == '__main__':
    main()
