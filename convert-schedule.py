#!/usr/bin/env python3
"""
Convert QGenda schedule from XLSX to JavaScript format.

Usage:
    python convert-schedule.py [input_file.xlsx]

If no input file is specified, defaults to schedule.xlsx in the same directory.
"""

import sys
import re
import json
import os
import tempfile
from pathlib import Path
from datetime import datetime
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import PatternFill


# Color mapping for RESIDENT YEAR LEVEL ONLY
# Colors are NOT reliable for determining if someone is a resident vs attending
# (e.g., cyan 0000FFFF is used for both CA2s and attendings)
# Use shift prefix to determine resident/faculty/crna, then use color for year level
#
# Verified mappings from user:
#   Incoming intern (dark blue): 000066CC
#   CA1 (purple): 009933FF (Koenig)
#   CA2 (cyan): 0000FFFF (Millett) - NOTE: attendings also use this color!
#   CA3 (teal): 0099CCCC (Yeker)
#   CRNA (light yellow-green): 00FFFF99 (Novelli) - NOTE: CRNAs can have CA shifts too!
COLOR_TO_YEAR = {
    # Incoming intern = Dark blue. The app promotes this baseline to intern on July 1.
    '000066CC': 'preintern',
    'FF0066CC': 'preintern',

    # Intern = Orange
    '00FF9933': 'intern',
    'FFFF9933': 'intern',

    # CA1 = Purple
    '009933FF': 'ca1',
    'FF9933FF': 'ca1',

    # CA2 = Cyan (but only for people with CA shifts!)
    '0000FFFF': 'ca2',
    'FF00FFFF': 'ca2',

    # CA3 = Teal
    '0099CCCC': 'ca3',
    'FF99CCCC': 'ca3',
}

# CRNA colors - used to identify CRNAs even if they have CA shifts
CRNA_COLORS = {
    '00FFFF99',
    'FFFFFF99',
}

# Normalize QGenda shift labels that lack the "CA " prefix
SHIFT_NORMALIZATION = {
    'GOR 1 Day Call': 'CA GOR1 Day Call',
    'GOR 2 Day Call': 'CA GOR2 Day Call',
    'Cart Day Call': 'CA CART Day Call',
    'Senior Day Call': 'CA Senior Day Call',
    'APS': 'CA APS',
    'APS Late': 'CA APS Late',
    'Intern APMC': 'CA Intern APMC',
    'Intern Pain Clinic': 'CA Intern Pain Clinic',
    'Resident Admin Day': 'CA Resident Admin Day',
    'Clin AM/Sim PM': 'CA Clin AM/Sim PM',
    'Sim AM/Clin PM': 'CA Sim AM/Clin PM',
}

SHIFT_PREFIXES = ('CA ', 'CRNA', 'Faculty', 'Fellow')
SHIFT_KEYWORDS = (
    'call', 'post', 'or', 'icu', 'pain', 'late', 'day', 'night', 'weekend',
    'home', 'sick', 'vacation', 'admin', 'coordinator', 'per diem', 'swing',
    'burn', 'students', 'clinic', 'lab', 'comer', 'ob', 'cardiac', 'other',
    'pre call', 'post call', 'jeopardy', 'fmla'
)
DAY_COLUMN_PAIRS = [(0, 1), (2, 3), (4, 5), (6, 7), (8, 9), (10, 11), (12, 13)]


def get_cell_color(cell):
    """Extract the background color from a cell."""
    try:
        fill = cell.fill
        if fill and fill.patternType == 'solid':
            fg_color = fill.fgColor
            if fg_color and fg_color.rgb:
                return fg_color.rgb
    except:
        pass
    return None


def get_year_level_from_color(color_rgb):
    """Get resident baseline year level from cell color.
    Returns None if color doesn't map to a known year level."""
    if not color_rgb:
        return None
    return COLOR_TO_YEAR.get(color_rgb)


def score_shift_text(text: str) -> int:
    """Heuristic score for whether a cell contains a shift label."""
    if not text:
        return 0

    lowered = text.lower()
    score = 0

    if text.startswith(SHIFT_PREFIXES):
        score += 8
    if any(keyword in lowered for keyword in SHIFT_KEYWORDS):
        score += 3
    if re.search(r'\d', text):
        score += 1
    if ' ' in text:
        score += 1
    if ',' in text:
        score -= 1

    return score


def score_name_text(text: str) -> int:
    """Heuristic score for whether a cell contains a staff name."""
    if not text:
        return 0

    lowered = text.lower()
    score = 0

    if any(keyword in lowered for keyword in SHIFT_KEYWORDS) or text.startswith(SHIFT_PREFIXES):
        score -= 5
    if ',' in text:
        score += 3
    if re.fullmatch(r"[A-Za-z .'-]+(?: \(\d+\))?", text):
        score += 2
    if text.isupper():
        score += 1
    if ' ' not in text:
        score += 1

    return score


def date_header(row):
    """Recognize calendar headers only; never treat print timestamps as dates."""
    dates = {}
    for day_idx, (col, _) in enumerate(DAY_COLUMN_PAIRS):
        if col >= len(row) or pd.isna(row.iloc[col]):
            continue
        value = row.iloc[col]
        if isinstance(value, (datetime, pd.Timestamp)) or re.fullmatch(
                r'[A-Za-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2}(?: 00:00:00)?', str(value).strip()):
            dates[day_idx] = pd.to_datetime(value).normalize()
    return dates


def roster_names(ws):
    """Use the export's abbreviation directory to keep stable, unambiguous names."""
    names = {}
    in_roster = False
    for row in ws.iter_rows(values_only=True):
        if row[:3] == ('Last Name', 'First Name', 'Abbr'):
            in_roster = True
            continue
        if in_roster and all(isinstance(value, str) and value.strip() for value in row[:3]):
            last, first, abbreviation = (value.strip() for value in row[:3])
            canonical = f'{last}, {first}'
            if abbreviation in names and names[abbreviation] != canonical:
                raise ValueError(f'Ambiguous roster abbreviation: {abbreviation}')
            names[abbreviation] = canonical
    return names


def detect_column_orientation(df: pd.DataFrame) -> tuple[int, int]:
    """Detect whether each day pair is name/shift or shift/name."""
    current_dates = {}
    name_shift_score = 0
    shift_name_score = 0
    samples = 0

    for _, row in df.iterrows():
        header = date_header(row)
        if header:
            current_dates = header
            continue
        if row.iloc[0] in ('Last Name', 'Schedule Notes:', 'Phone Numbers'):
            break

        for day_idx, (first_col, second_col) in enumerate(DAY_COLUMN_PAIRS):
            if day_idx not in current_dates:
                continue
            if pd.isna(row[first_col]) or pd.isna(row[second_col]):
                continue

            first_text = str(row[first_col]).strip()
            second_text = str(row[second_col]).strip()
            if not first_text or not second_text:
                continue

            name_shift_score += score_name_text(first_text) + score_shift_text(second_text)
            shift_name_score += score_shift_text(first_text) + score_name_text(second_text)
            samples += 1

            if samples >= 250:
                break

        if samples >= 250:
            break

    if shift_name_score > name_shift_score:
        return 1, 0
    return 0, 1


def parse_qgenda_excel(file_path: Path) -> tuple[pd.DataFrame, dict]:
    """Parse QGenda Excel export into a clean DataFrame and extract person colors."""
    # Load workbook with openpyxl to get colors
    wb = load_workbook(file_path, data_only=True)
    ws = wb.active
    canonical_names = roster_names(ws)

    # Also load with pandas for easier data handling
    df = pd.read_excel(file_path, header=None, engine='openpyxl')

    records = []
    current_dates = {}
    person_colors = {}  # name -> color RGB
    name_offset, shift_offset = detect_column_orientation(df)

    for idx, row in df.iterrows():
        excel_row = idx + 1  # Excel rows are 1-indexed

        if row.iloc[0] in ('Last Name', 'Schedule Notes:', 'Phone Numbers'):
            break
        header = date_header(row)
        if header:
            # Clear dates omitted from a partial final week.
            current_dates = header
            continue

        # Process data rows
        for day_idx, (first_col, second_col) in enumerate(DAY_COLUMN_PAIRS):
            name_col = first_col + name_offset
            shift_col = first_col + shift_offset
            if day_idx in current_dates and pd.notna(row[name_col]) and pd.notna(row[shift_col]):
                raw_name = str(row[name_col]).strip()
                name = canonical_names.get(raw_name, raw_name)
                shift = str(row[shift_col]).strip()
                skip_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Printed']
                if name and shift and not any(s in name for s in skip_names):
                    records.append({
                        'date': current_dates[day_idx],
                        'name': name,
                        'shift': shift
                    })

                    # Extract color for person classification
                    if name not in person_colors:
                        try:
                            cell = ws.cell(row=excel_row, column=name_col + 1)  # openpyxl is 1-indexed
                            color = get_cell_color(cell)
                            if color:
                                person_colors[name] = color
                        except:
                            pass

    wb.close()
    return pd.DataFrame(records), person_colors


def convert_to_javascript(df: pd.DataFrame, person_colors: dict, output_path: Path, input_file: Path):
    """Convert DataFrame to JavaScript format and write to file."""
    # Normalize known CA shifts that lack the "CA " prefix in QGenda exports
    if df.empty or not {'date', 'name', 'shift'}.issubset(df.columns):
        raise ValueError('No schedule entries parsed; existing schedule was not changed.')
    df = df.copy()
    df['shift'] = df['shift'].apply(lambda s: SHIFT_NORMALIZATION.get(s, s) if isinstance(s, str) else s)

    # Classify people by SHIFT PREFIX first, then use color for year level
    # This is because colors are shared between residents and attendings
    person_types = {}

    for name in df['name'].unique():
        person_shifts = df[df['name'] == name]['shift'].tolist()
        has_ca = any(s.startswith('CA ') for s in person_shifts)
        has_crna = any('CRNA' in s for s in person_shifts)
        has_faculty = any(s.startswith('Faculty') for s in person_shifts)
        has_fellow = any('fellow' in s.lower() for s in person_shifts)

        color = person_colors.get(name)

        if has_faculty:
            person_types[name] = 'faculty'
        elif has_crna:
            person_types[name] = 'crna'
        elif color in CRNA_COLORS:
            # CRNA color but has CA shifts - still a CRNA
            person_types[name] = 'crna'
        elif has_fellow:
            person_types[name] = 'fellow'
        elif has_ca:
            # It's a resident - use color to determine year level
            year_level = get_year_level_from_color(color)
            if year_level:
                person_types[name] = year_level
            else:
                person_types[name] = 'resident'  # Unknown year level

    # Retain every assignment for identified staff, including unprefixed work.
    # Unknown resident labels remain visible to the app's data-quality audit.
    filtered_shifts = df[df['name'].isin(person_types)].copy()
    prefixes = {'faculty': 'Faculty ', 'crna': 'CRNA ', 'fellow': 'Fellow '}
    def normalize_assignment(row):
        shift = row['shift']
        if shift.startswith(('CA ', 'CRNA', 'Faculty', 'Fellow')):
            return shift
        return prefixes.get(person_types[row['name']], 'CA ') + shift
    if filtered_shifts.empty:
        raise ValueError('No recognized schedule entries; existing schedule was not changed.')
    filtered_shifts['shift'] = filtered_shifts.apply(normalize_assignment, axis=1)
    filtered_shifts = filtered_shifts.drop_duplicates(subset=['date', 'name', 'shift'])
    filtered_shifts = filtered_shifts.sort_values(['date', 'name', 'shift'])

    # Generate timestamp
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    date_start = filtered_shifts['date'].min().strftime('%Y-%m-%d') if len(filtered_shifts) else ''
    date_end = filtered_shifts['date'].max().strftime('%Y-%m-%d') if len(filtered_shifts) else ''
    source_name = json.dumps(input_file.name)

    # Build JavaScript content
    js_lines = [
        f"// Generated from {input_file.name}",
        f"// Last updated: {timestamp}",
        "const SCHEDULE_METADATA = {",
        f'  sourceFile: {source_name},',
        f'  lastUpdated: "{timestamp}",',
        f'  dateStart: "{date_start}",',
        f'  dateEnd: "{date_end}",',
        f'  recordCount: {len(filtered_shifts)},',
        '  personTypePromotionDate: "2026-07-01",',
        "};",
        "",
        "const SCHEDULE = ["
    ]

    # Add data rows
    for _, row in filtered_shifts.iterrows():
        date_str = row['date'].strftime('%Y-%m-%d')
        record = {'date': date_str, 'name': row['name'], 'shift': row['shift']}
        js_lines.append('  ' + json.dumps(record, ensure_ascii=False) + ',')

    js_lines.append("];")
    js_lines.append("")

    # Add person types mapping
    js_lines.append("// Person types: preintern, intern, ca1, ca2, ca3, fellow, crna, faculty, resident (unknown year)")
    js_lines.append("const PERSON_TYPES_DATA = {")
    for name, ptype in sorted(person_types.items()):
        js_lines.append(f'  {json.dumps(name, ensure_ascii=False)}: {json.dumps(ptype)},')
    js_lines.append("};")

    # Install atomically so a failed write cannot truncate the working schedule.
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output_path.parent,
                                     suffix='.tmp', delete=False) as handle:
        temporary_path = Path(handle.name)
        try:
            handle.write('\n'.join(js_lines))
        except BaseException:
            temporary_path.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)

    # Print residents with unknown year level for debugging
    unknown_year = [n for n, t in person_types.items() if t == 'resident']
    if unknown_year:
        print(f"\nResidents with unknown year level ({len(unknown_year)}):")
        for name in unknown_year[:10]:
            color = person_colors.get(name, 'no color')
            print(f"  {name}: {color}")

    print(f"\nPerson type breakdown:")
    type_counts = {}
    for ptype in person_types.values():
        type_counts[ptype] = type_counts.get(ptype, 0) + 1
    for ptype, count in sorted(type_counts.items()):
        print(f"  {ptype}: {count}")

    return len(filtered_shifts)


def main():
    # Get script directory
    script_dir = Path(__file__).parent

    # Determine input file
    if len(sys.argv) > 1:
        input_file = Path(sys.argv[1])
    else:
        input_file = script_dir / "schedule.xlsx"

    # Check if input file exists
    if not input_file.exists():
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)

    # Output file path
    output_file = script_dir / "js" / "schedule.js"
    output_file.parent.mkdir(exist_ok=True)

    print(f"Reading schedule from: {input_file}")

    # Parse Excel file
    try:
        df, person_colors = parse_qgenda_excel(input_file)
        print(f"Parsed {len(df)} total schedule entries")
        print(f"Found colors for {len(person_colors)} people")
    except Exception as e:
        print(f"Error parsing Excel file: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    # Convert to JavaScript
    try:
        num_records = convert_to_javascript(df, person_colors, output_file, input_file)
        print(f"Exported {num_records} shift records to: {output_file}")
        print(f"✓ Successfully generated {output_file.name}")
    except Exception as e:
        print(f"Error generating JavaScript file: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
