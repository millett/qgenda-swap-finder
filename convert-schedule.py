#!/usr/bin/env python3
"""
Convert QGenda schedule from XLSX to JavaScript format.

Usage:
    python convert-schedule.py [input_file.xlsx]

If no input file is specified, defaults to schedule.xlsx in the same directory.
"""

import sys
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
#   CA1 (purple): 009933FF (Koenig)
#   CA2 (cyan): 0000FFFF (Millett) - NOTE: attendings also use this color!
#   CA3 (teal): 0099CCCC (Yeker)
#   CRNA (light yellow-green): 00FFFF99 (Novelli) - NOTE: CRNAs can have CA shifts too!
COLOR_TO_YEAR = {
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
    """Get resident year level (ca1/ca2/ca3) from cell color.
    Returns None if color doesn't map to a known year level."""
    if not color_rgb:
        return None
    return COLOR_TO_YEAR.get(color_rgb)


def parse_qgenda_excel(file_path: Path) -> tuple[pd.DataFrame, dict]:
    """Parse QGenda Excel export into a clean DataFrame and extract person colors."""
    # Load workbook with openpyxl to get colors
    wb = load_workbook(file_path, data_only=True)
    ws = wb.active

    # Also load with pandas for easier data handling
    df = pd.read_excel(file_path, header=None, engine='openpyxl')

    records = []
    current_dates = {}
    person_colors = {}  # name -> color RGB

    for idx, row in df.iterrows():
        excel_row = idx + 1  # Excel rows are 1-indexed

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
    # Include CA, CRNA, Faculty, and Fellow shifts for proper classification
    valid_prefixes = ('CA ', 'CRNA', 'Faculty', 'Fellow')
    filtered_shifts = df[df['shift'].str.startswith(valid_prefixes, na=False)].copy()

    # Sort by date
    filtered_shifts = filtered_shifts.sort_values('date')

    # Classify people by SHIFT PREFIX first, then use color for year level
    # This is because colors are shared between residents and attendings
    person_types = {}

    for name in filtered_shifts['name'].unique():
        person_shifts = filtered_shifts[filtered_shifts['name'] == name]['shift'].tolist()
        has_ca = any(s.startswith('CA ') for s in person_shifts)
        has_crna = any('CRNA' in s for s in person_shifts)
        has_faculty = any(s.startswith('Faculty') for s in person_shifts)
        has_fellow = any(s.startswith('Fellow') for s in person_shifts)

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

    # Generate timestamp
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Build JavaScript content
    js_lines = [
        f"// Generated from {input_file.name}",
        f"// Last updated: {timestamp}",
        "const SCHEDULE = ["
    ]

    # Add data rows
    for _, row in filtered_shifts.iterrows():
        date_str = row['date'].strftime('%Y-%m-%d')
        name = row['name'].replace('"', '\\"')  # Escape quotes
        shift = row['shift'].replace('"', '\\"')
        js_lines.append(f'  {{ date: "{date_str}", name: "{name}", shift: "{shift}" }},')

    js_lines.append("];")
    js_lines.append("")

    # Add person types mapping
    js_lines.append("// Person types: intern, ca1, ca2, ca3, fellow, crna, faculty, resident (unknown year)")
    js_lines.append("const PERSON_TYPES_DATA = {")
    for name, ptype in sorted(person_types.items()):
        escaped_name = name.replace('"', '\\"')
        js_lines.append(f'  "{escaped_name}": "{ptype}",')
    js_lines.append("};")

    # Write to file
    output_path.write_text('\n'.join(js_lines))

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
