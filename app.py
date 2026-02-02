#!/usr/bin/env python3
"""
QGenda Swap Finder - Web Interface

A Streamlit app for finding shift swap candidates.

Run with: streamlit run qgenda/app.py
"""

import streamlit as st
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path

# Import from swap_finder
from swap_finder import (
    parse_qgenda_excel,
    find_swap_candidates,
    find_weekend_swap,
    find_trip_coverage,
    find_golden_weekends,
    get_schedule_summary,
    generate_swap_message,
    load_friends,
    save_friends,
    load_ledger,
    save_ledger,
    filter_by_friends,
    classify_weekend_type,
    has_post_call_conflict,
    CALL_SHIFTS,
    DAY_SHIFTS,
    UNAVAILABLE_SHIFTS,
    NIGHT_CALL_SHIFTS,
)

# Constants
DEFAULT_NAME = "Millett, Matthew"
QGENDA_DIR = Path(__file__).parent
DEFAULT_SCHEDULE_FILE = Path(__file__).parent / "schedule.xlsx"


def get_schedule_file() -> tuple[Path | None, str]:
    """
    Get the current schedule file path and status.

    Returns:
        Tuple of (file_path or None, status_message)
    """
    # Check for uploaded files in qgenda directory (timestamped)
    uploaded_files = sorted(QGENDA_DIR.glob("schedule-upload-*.xlsx"), reverse=True)

    if uploaded_files:
        latest = uploaded_files[0]
        mod_time = datetime.fromtimestamp(latest.stat().st_mtime)
        days_old = (datetime.now() - mod_time).days
        if days_old == 0:
            status = f"Uploaded today"
        elif days_old == 1:
            status = f"Uploaded yesterday"
        else:
            status = f"Uploaded {days_old} days ago"
        return latest, status

    # Fall back to default file
    if DEFAULT_SCHEDULE_FILE is not None and DEFAULT_SCHEDULE_FILE.exists():
        mod_time = datetime.fromtimestamp(DEFAULT_SCHEDULE_FILE.stat().st_mtime)
        days_old = (datetime.now() - mod_time).days
        if days_old > 7:
            status = f"Default file ({days_old} days old - consider uploading new)"
        else:
            status = f"Default file"
        return DEFAULT_SCHEDULE_FILE, status

    return None, "No schedule file found"


def get_schedule_status(schedule_file: Path | None) -> tuple[str, str]:
    """
    Get schedule status indicator color and message.

    Returns:
        Tuple of (color_emoji, status_message)
    """
    if schedule_file is None:
        return "🔴", "No schedule file"

    mod_time = datetime.fromtimestamp(schedule_file.stat().st_mtime)
    days_old = (datetime.now() - mod_time).days

    if days_old <= 7:
        return "🟢", f"Current (updated {days_old}d ago)"
    elif days_old <= 30:
        return "🟡", f"Getting stale ({days_old}d old)"
    else:
        return "🔴", f"Outdated ({days_old}d old)"


@st.cache_data
def load_schedule(file_path: str):
    """Load and cache the schedule data."""
    path = Path(file_path)
    if not path.exists():
        return None
    return parse_qgenda_excel(path)


def get_ca_schedule(schedule: pd.DataFrame) -> pd.DataFrame:
    """Filter to CA (resident) shifts only."""
    return schedule[schedule['shift'].str.startswith('CA ')]


def main():
    st.set_page_config(
        page_title="QGenda Swap Finder",
        page_icon="🔄",
        layout="wide",
    )

    st.title("QGenda Swap Finder")

    # Sidebar - Schedule Management
    st.sidebar.header("Schedule")

    # File uploader
    uploaded_file = st.sidebar.file_uploader(
        "Upload QGenda Export",
        type=['xlsx'],
        help="Export your schedule from QGenda as Excel (.xlsx) and upload here",
    )

    if uploaded_file is not None:
        # Save uploaded file with timestamp
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        save_path = QGENDA_DIR / f"schedule-upload-{timestamp}.xlsx"
        with open(save_path, "wb") as f:
            f.write(uploaded_file.getvalue())
        st.sidebar.success(f"Uploaded: {uploaded_file.name}")
        # Clear cache to reload
        load_schedule.clear()
        st.rerun()

    # Get current schedule file
    schedule_file, file_status = get_schedule_file()

    # Show schedule status
    if schedule_file:
        status_color, status_msg = get_schedule_status(schedule_file)
        st.sidebar.markdown(f"{status_color} **Status:** {status_msg}")
        st.sidebar.caption(f"File: {schedule_file.name}")
    else:
        st.sidebar.error("No schedule file found")
        st.sidebar.info("Upload a QGenda Excel export to get started.")
        return

    # Load schedule
    schedule = load_schedule(str(schedule_file))
    if schedule is None:
        st.error(f"Could not load schedule from: {schedule_file}")
        return

    ca_schedule = get_ca_schedule(schedule)

    # Get date range from schedule
    min_date = ca_schedule['date'].min().date()
    max_date = ca_schedule['date'].max().date()

    # Show schedule info
    st.sidebar.caption(f"Date range: {min_date} to {max_date}")
    shift_count = len(ca_schedule)
    resident_count = ca_schedule['name'].nunique()
    st.sidebar.caption(f"{shift_count} shifts, {resident_count} residents")

    st.sidebar.divider()

    # Sidebar - User settings
    st.sidebar.header("Settings")
    my_name = st.sidebar.text_input("Your name (as in QGenda)", value=DEFAULT_NAME)

    # Tabs for different features
    tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
        "My Schedule",
        "Golden Weekends",
        "Trip Planner",
        "Weekend Swap",
        "Who's Free",
        "Friends List",
        "Swap Ledger",
    ])

    # Tab 1: My Schedule Dashboard
    with tab1:
        st.header("My Schedule")
        st.write("Your upcoming shifts at a glance.")

        days_ahead = st.slider("Days to look ahead", 7, 90, 30, key="schedule_days")

        summary = get_schedule_summary(ca_schedule, my_name, days_ahead=days_ahead)
        stats = summary['stats']

        # Top metrics row
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            if stats['next_call']:
                next_call_date, next_call_shift = stats['next_call']
                days_until = (next_call_date - pd.Timestamp.now().normalize()).days
                st.metric("Next Call", f"in {days_until} days", next_call_shift)
            else:
                st.metric("Next Call", "None scheduled", "")

        with col2:
            st.metric("Total Calls", stats['total_calls'], f"next {days_ahead} days")

        with col3:
            st.metric("Day Shifts", stats['total_day_shifts'], f"next {days_ahead} days")

        with col4:
            st.metric("Days Off", stats['days_off'], f"next {days_ahead} days")

        # Next golden weekend
        if stats['next_golden_weekend']:
            st.info(f"🏖️ Next weekend off: **{stats['next_golden_weekend'].strftime('%m/%d')}**")

        # Upcoming shifts list with icons
        st.subheader("Upcoming Shifts")

        if summary['upcoming_shifts'].empty:
            st.success("No shifts scheduled!")
        else:
            shifts_df = summary['upcoming_shifts'].copy()

            # Add icon column
            def get_shift_icon(row):
                shift = row['shift']
                if 'Night' in shift or 'Call' in shift:
                    return '🌙'
                elif row['shift_type'] == 'day':
                    return '☀️'
                elif 'Vacation' in shift:
                    return '🏖️'
                elif 'Post Call' in shift:
                    return '✅'
                return '📋'

            shifts_df['icon'] = shifts_df.apply(get_shift_icon, axis=1)
            shifts_df['date_str'] = shifts_df['date'].dt.strftime('%a %m/%d')

            # Display
            display_df = shifts_df[['icon', 'date_str', 'shift', 'days_until']].copy()
            display_df.columns = ['', 'Date', 'Shift', 'Days Until']
            st.dataframe(display_df, use_container_width=True, hide_index=True)

        # Weekly breakdown
        st.subheader("Weekly Breakdown")
        if not summary['weekly_breakdown'].empty:
            weekly_df = summary['weekly_breakdown'].copy()
            weekly_df.columns = ['Week Of', 'Calls', 'Day Shifts', 'Off Days']
            st.dataframe(weekly_df, use_container_width=True, hide_index=True)

    # Tab 2: Golden Weekends
    with tab2:
        st.header("Golden Weekends")
        st.write("Find weekends where you AND your friends are off.")

        col1, col2, col3 = st.columns(3)
        with col1:
            weeks_ahead = st.slider("Weeks to look ahead", 4, 24, 12, key="golden_weeks")
        with col2:
            only_my_off = st.checkbox("Only show weekends I'm off", value=True, key="golden_my_off")
        with col3:
            min_friends = st.number_input("Minimum friends off", min_value=0, max_value=10, value=1, key="golden_min_friends")

        if st.button("Find Golden Weekends", type="primary", key="btn_golden"):
            with st.spinner("Scanning weekends..."):
                golden_df = find_golden_weekends(
                    ca_schedule,
                    my_name,
                    look_forward_weeks=weeks_ahead,
                    friends_only=True,
                )

            if only_my_off:
                golden_df = golden_df[golden_df['i_am_off']]

            if min_friends > 0:
                golden_df = golden_df[golden_df['friends_off_count'] >= min_friends]

            st.subheader("Results")

            if golden_df.empty:
                st.warning("No golden weekends found with your criteria.")
            else:
                # Highlight weekends with 3+ friends
                for _, row in golden_df.iterrows():
                    friend_count = row['friends_off_count']

                    # Color coding
                    if friend_count >= 3:
                        emoji = "🌟"
                        color = "green"
                    elif friend_count >= 2:
                        emoji = "✨"
                        color = "blue"
                    else:
                        emoji = "📅"
                        color = "gray"

                    off_status = "✅ You're off" if row['i_am_off'] else "❌ You're working"

                    with st.expander(f"{emoji} **{row['weekend']}** - {friend_count} friends off ({off_status})"):
                        st.write(f"**Status:** {off_status}")
                        st.write(f"**Friends available ({friend_count}):**")
                        if row['friends_off']:
                            for friend in row['friends_off']:
                                st.write(f"  - {friend}")
                        else:
                            st.write("  No friends off this weekend")
                        st.caption(f"Total residents off: {row['all_residents_off_count']}")

    # Tab 3: Trip Planner
    with tab3:
        st.header("Trip Planner")
        st.write("Find coverage for all shifts during a trip.")

        col1, col2 = st.columns(2)
        with col1:
            trip_start = st.date_input(
                "Trip start date",
                value=datetime.now().date() + timedelta(days=7),
                min_value=min_date,
                max_value=max_date,
                key="trip_start",
            )
        with col2:
            trip_end = st.date_input(
                "Trip end date",
                value=datetime.now().date() + timedelta(days=10),
                min_value=min_date,
                max_value=max_date,
                key="trip_end",
            )

        col3, col4 = st.columns(2)
        with col3:
            depart_evening = st.checkbox(
                "Departing evening before",
                help="Include night call the day before trip start",
            )
        with col4:
            friends_only_trip = st.checkbox("Friends only", key="friends_trip")

        if st.button("Find Coverage", type="primary", key="btn_trip"):
            if trip_start > trip_end:
                st.error("Start date must be before end date")
            else:
                with st.spinner("Finding coverage options..."):
                    result = find_trip_coverage(
                        ca_schedule,
                        my_name,
                        trip_start.strftime("%Y-%m-%d"),
                        trip_end.strftime("%Y-%m-%d"),
                        depart_day_before=depart_evening,
                    )

                # Show blocking shifts
                st.subheader("Your Shifts During Trip")
                if result['blocking_shifts']:
                    blocking_data = []
                    for shift in result['blocking_shifts']:
                        blocking_data.append({
                            'Date': shift['date'].strftime('%a %m/%d'),
                            'Shift': shift['shift'],
                            'Status': '🚫 BLOCKS' if shift['blocks_travel'] else '✅ OK',
                            'Reason': shift['reason'] if shift['blocks_travel'] else '',
                        })
                    st.dataframe(
                        pd.DataFrame(blocking_data),
                        use_container_width=True,
                        hide_index=True,
                    )
                else:
                    st.success("No shifts during this period!")

                # Show package deals
                if result['package_recommendations']:
                    st.subheader("Package Deals")
                    st.write("People who can cover multiple shifts:")

                    for pkg in result['package_recommendations']:
                        if friends_only_trip:
                            friends_data = load_friends()
                            if pkg['candidate'] not in friends_data.get('friends', []):
                                continue

                        with st.expander(f"**{pkg['candidate']}** - can cover {pkg['coverage_count']} shifts"):
                            for shift_key in pkg['can_cover']:
                                st.write(f"- {shift_key}")

                # Show candidates by shift
                st.subheader("Candidates by Shift")
                for shift_key, candidates in result['candidates_by_shift'].items():
                    with st.expander(f"**{shift_key}**"):
                        if friends_only_trip:
                            candidates = filter_by_friends(candidates)

                        if candidates.empty:
                            st.write("No candidates found")
                        else:
                            display_df = candidates[['candidate', 'their_date', 'their_shift']].copy()
                            display_df['their_date'] = display_df['their_date'].dt.strftime('%a %m/%d')
                            display_df.columns = ['Candidate', 'Their Date', 'Their Shift']
                            st.dataframe(display_df, use_container_width=True, hide_index=True)

    # Tab 4: Weekend Swap
    with tab4:
        st.header("Weekend Swap")
        st.write("Find someone to swap an entire weekend with.")

        col1, col2, col3 = st.columns(3)
        with col1:
            saturday = st.date_input(
                "Saturday of your weekend",
                value=datetime.now().date() + timedelta(days=(5 - datetime.now().weekday()) % 7),
                min_value=min_date,
                max_value=max_date,
                key="weekend_sat",
            )
        with col2:
            weeks_search = st.slider("Weeks to search", 1, 8, 4)
        with col3:
            friends_only_weekend = st.checkbox("Friends only", key="friends_weekend")

        if st.button("Find Weekend Swaps", type="primary", key="btn_weekend"):
            sunday = saturday + timedelta(days=1)

            with st.spinner("Searching for weekend swaps..."):
                candidates = find_weekend_swap(
                    ca_schedule,
                    my_name,
                    [saturday, sunday],
                    look_back_weeks=weeks_search,
                    look_forward_weeks=weeks_search,
                )

            if friends_only_weekend and not candidates.empty:
                candidates = filter_by_friends(candidates)

            st.subheader(f"Your weekend: {saturday.strftime('%m/%d')} - {sunday.strftime('%m/%d')}")

            # Show my shifts that weekend and classify type
            my_weekend = ca_schedule[
                (ca_schedule['name'] == my_name) &
                (ca_schedule['date'].isin([pd.Timestamp(saturday), pd.Timestamp(sunday)]))
            ]

            # Determine my weekend type for display
            my_sat_shifts = set(my_weekend[my_weekend['date'] == pd.Timestamp(saturday)]['shift'].tolist())
            my_sun_shifts = set(my_weekend[my_weekend['date'] == pd.Timestamp(sunday)]['shift'].tolist())
            my_weekend_type = classify_weekend_type(my_sat_shifts, my_sun_shifts)

            # Display weekend type with color
            type_colors = {'night': '🌙', 'day': '☀️', 'off': '🏖️'}
            st.markdown(f"**Your weekend type:** {type_colors.get(my_weekend_type, '')} {my_weekend_type.upper()}")

            if not my_weekend.empty:
                st.write("Your shifts:")
                for _, row in my_weekend.iterrows():
                    st.write(f"- {row['date'].strftime('%a %m/%d')}: {row['shift']}")
            else:
                st.write("You are OFF this weekend")

            st.subheader("Potential Swaps")
            if candidates.empty:
                st.warning("No weekend swap candidates found.")
            else:
                # Store candidates in session state for message generation
                st.session_state['weekend_candidates'] = candidates
                st.session_state['my_weekend_str'] = f"{saturday.strftime('%m/%d')} - {sunday.strftime('%m/%d')}"
                st.session_state['my_weekend_shifts'] = ', '.join(my_sat_shifts | my_sun_shifts) if (my_sat_shifts | my_sun_shifts) else 'OFF'

                # Color-code by ease level
                def color_ease(val):
                    if val == 'Easy':
                        return 'background-color: #d4edda'  # green
                    elif val == 'Moderate':
                        return 'background-color: #fff3cd'  # yellow
                    elif val == 'Hard sell':
                        return 'background-color: #f8d7da'  # light red
                    elif val == 'Very hard':
                        return 'background-color: #dc3545; color: white'  # dark red
                    return ''

                # Display with styling
                display_cols = ['candidate', 'their_weekend', 'swap_type', 'ease', 'their_sat_shift', 'their_sun_shift']
                display_df = candidates[display_cols].copy()
                display_df.columns = ['Candidate', 'Their Weekend', 'Swap Type', 'Ease', 'Sat Shift', 'Sun Shift']

                styled_df = display_df.style.map(color_ease, subset=['Ease'])
                st.dataframe(
                    styled_df,
                    use_container_width=True,
                    hide_index=True,
                )

                # Message generator section
                st.subheader("Generate Swap Message")
                st.write("Select a candidate to generate a swap request message.")

                candidate_options = [""] + candidates['candidate'].tolist()
                selected_candidate = st.selectbox(
                    "Select candidate",
                    options=candidate_options,
                    key="msg_candidate",
                )

                if selected_candidate:
                    # Get candidate's row
                    cand_row = candidates[candidates['candidate'] == selected_candidate].iloc[0]

                    # Generate message
                    message = generate_swap_message(
                        candidate_name=selected_candidate,
                        my_shift=st.session_state.get('my_weekend_shifts', 'my shift'),
                        my_date=st.session_state.get('my_weekend_str', 'my weekend'),
                        their_shift=f"{cand_row['their_sat_shift']}/{cand_row['their_sun_shift']}",
                        their_date=cand_row['their_weekend'],
                        swap_ease=cand_row['ease'],
                        swap_type='weekend',
                    )

                    st.text_area(
                        "Draft message (edit as needed):",
                        value=message,
                        height=150,
                        key="swap_message",
                    )
                    st.caption("Copy this message and send via text/email/Slack!")

    # Tab 5: Who's Free
    with tab5:
        st.header("Who's Free")
        st.write("See who is available on a specific date.")

        col1, col2 = st.columns(2)
        with col1:
            check_date = st.date_input(
                "Date to check",
                value=datetime.now().date(),
                min_value=min_date,
                max_value=max_date,
                key="free_date",
            )
        with col2:
            friends_only_free = st.checkbox("Friends only", key="friends_free")

        if st.button("Check Availability", type="primary", key="btn_free"):
            date_ts = pd.Timestamp(check_date)

            # Get all residents
            all_residents = set(ca_schedule['name'].unique())

            # Filter to friends if requested
            if friends_only_free:
                friends_data = load_friends()
                all_residents = all_residents & set(friends_data.get('friends', []))

            # Find who has no call/unavailable shifts that day
            busy_that_day = ca_schedule[
                (ca_schedule['date'] == date_ts) &
                (ca_schedule['shift'].isin(CALL_SHIFTS | UNAVAILABLE_SHIFTS))
            ]['name'].unique()

            free_residents = sorted(all_residents - set(busy_that_day))

            st.subheader(f"Available on {check_date.strftime('%A, %B %d')}")

            if not free_residents:
                st.warning("No one is free on this date.")
            else:
                results = []
                for name in free_residents:
                    their_shifts = ca_schedule[
                        (ca_schedule['name'] == name) &
                        (ca_schedule['date'] == date_ts)
                    ]
                    shifts = ', '.join(their_shifts['shift'].tolist()) if not their_shifts.empty else 'OFF'
                    results.append({'Resident': name, 'Scheduled': shifts})

                st.dataframe(
                    pd.DataFrame(results),
                    use_container_width=True,
                    hide_index=True,
                )

    # Tab 6: Friends List
    with tab6:
        st.header("Friends List")
        st.write("Manage your list of preferred swap partners.")

        friends_data = load_friends()
        friends = friends_data.get('friends', [])
        notes = friends_data.get('notes', {})
        prefers_nights = set(friends_data.get('prefers_nights', []))

        # Display current friends
        st.subheader("Current Friends")
        if friends:
            for friend in friends:
                col1, col2, col3, col4 = st.columns([3, 2, 1, 1])
                with col1:
                    night_icon = "🌙 " if friend in prefers_nights else ""
                    st.write(f"**{night_icon}{friend}**")
                with col2:
                    if friend in notes:
                        st.caption(notes[friend])
                with col3:
                    # Toggle prefers nights
                    current_pref = friend in prefers_nights
                    if st.checkbox(
                        "Nights",
                        value=current_pref,
                        key=f"nights_{friend}",
                        help="Check if this person prefers night shifts",
                    ):
                        if friend not in prefers_nights:
                            if 'prefers_nights' not in friends_data:
                                friends_data['prefers_nights'] = []
                            friends_data['prefers_nights'].append(friend)
                            save_friends(friends_data)
                            st.rerun()
                    else:
                        if friend in prefers_nights:
                            friends_data['prefers_nights'].remove(friend)
                            save_friends(friends_data)
                            st.rerun()
                with col4:
                    if st.button("Remove", key=f"remove_{friend}"):
                        friends_data['friends'].remove(friend)
                        if friend in friends_data.get('notes', {}):
                            del friends_data['notes'][friend]
                        if friend in friends_data.get('prefers_nights', []):
                            friends_data['prefers_nights'].remove(friend)
                        save_friends(friends_data)
                        st.rerun()
        else:
            st.info("No friends added yet.")

        st.caption("🌙 = prefers night shifts (affects swap ease calculation)")

        # Add new friend
        st.subheader("Add Friend")

        # Get list of all residents for autocomplete
        all_residents = sorted(ca_schedule['name'].unique())
        non_friends = [r for r in all_residents if r not in friends]

        col1, col2, col3 = st.columns([2, 1, 1])
        with col1:
            new_friend = st.selectbox(
                "Select resident",
                options=[""] + non_friends,
                key="new_friend_select",
            )
        with col2:
            friend_note = st.text_input("Note (optional)", key="friend_note")
        with col3:
            new_friend_prefers_nights = st.checkbox(
                "Prefers nights",
                key="new_friend_nights",
                help="Check if this person prefers night shifts",
            )

        if st.button("Add Friend", type="primary", key="btn_add_friend"):
            if new_friend:
                if new_friend not in friends_data['friends']:
                    friends_data['friends'].append(new_friend)
                    if friend_note:
                        if 'notes' not in friends_data:
                            friends_data['notes'] = {}
                        friends_data['notes'][new_friend] = friend_note
                    if new_friend_prefers_nights:
                        if 'prefers_nights' not in friends_data:
                            friends_data['prefers_nights'] = []
                        friends_data['prefers_nights'].append(new_friend)
                    save_friends(friends_data)
                    st.success(f"Added {new_friend}")
                    st.rerun()
                else:
                    st.warning(f"{new_friend} is already a friend")
            else:
                st.warning("Please select a resident")

    # Tab 7: Swap Ledger
    with tab7:
        st.header("Swap Ledger")
        st.write("Track who owes whom a swap.")

        ledger_data = load_ledger()
        debts = ledger_data.get('debts', [])

        # Display current debts
        col1, col2 = st.columns(2)

        with col1:
            st.subheader("They Owe You")
            owes_me = [d for d in debts if d['direction'] == 'owes_me']
            if owes_me:
                for i, debt in enumerate(debts):
                    if debt['direction'] == 'owes_me':
                        idx = debts.index(debt)
                        shift_info = f"{debt.get('shift', '?')} on {debt.get('date', '?')}" if debt.get('shift') else "unspecified shift"
                        notes_str = f" - {debt['notes']}" if debt.get('notes') else ""

                        c1, c2 = st.columns([4, 1])
                        with c1:
                            st.write(f"**{debt['person']}**: {shift_info}{notes_str}")
                        with c2:
                            if st.button("Clear", key=f"clear_{idx}"):
                                debts.pop(idx)
                                save_ledger(ledger_data)
                                st.rerun()
            else:
                st.info("No one owes you")

        with col2:
            st.subheader("You Owe Them")
            i_owe = [d for d in debts if d['direction'] == 'i_owe']
            if i_owe:
                for i, debt in enumerate(debts):
                    if debt['direction'] == 'i_owe':
                        idx = debts.index(debt)
                        shift_info = f"{debt.get('shift', '?')} on {debt.get('date', '?')}" if debt.get('shift') else "unspecified shift"
                        notes_str = f" - {debt['notes']}" if debt.get('notes') else ""

                        c1, c2 = st.columns([4, 1])
                        with c1:
                            st.write(f"**{debt['person']}**: {shift_info}{notes_str}")
                        with c2:
                            if st.button("Clear", key=f"clear_{idx}"):
                                debts.pop(idx)
                                save_ledger(ledger_data)
                                st.rerun()
            else:
                st.info("You don't owe anyone")

        # Add new debt
        st.subheader("Add Debt")

        # Get list of all residents for autocomplete
        all_residents = sorted(ca_schedule['name'].unique())

        col1, col2 = st.columns(2)
        with col1:
            debt_person = st.selectbox(
                "Person",
                options=[""] + all_residents,
                key="debt_person",
            )
        with col2:
            debt_direction = st.radio(
                "Direction",
                options=["They owe me", "I owe them"],
                horizontal=True,
                key="debt_direction",
            )

        col3, col4 = st.columns(2)
        with col3:
            debt_shift = st.text_input("Shift type (optional)", key="debt_shift")
        with col4:
            debt_date = st.date_input(
                "Date (optional)",
                value=None,
                key="debt_date",
            )

        debt_notes = st.text_input("Notes (optional)", key="debt_notes")

        if st.button("Add Debt", type="primary", key="btn_add_debt"):
            if debt_person:
                new_debt = {
                    'person': debt_person,
                    'direction': 'owes_me' if debt_direction == "They owe me" else 'i_owe',
                }
                if debt_shift:
                    new_debt['shift'] = debt_shift
                if debt_date:
                    new_debt['date'] = debt_date.strftime("%Y-%m-%d")
                if debt_notes:
                    new_debt['notes'] = debt_notes

                ledger_data['debts'].append(new_debt)
                save_ledger(ledger_data)
                st.success(f"Added debt for {debt_person}")
                st.rerun()
            else:
                st.warning("Please select a person")


if __name__ == "__main__":
    main()
