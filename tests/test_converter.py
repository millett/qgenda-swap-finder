import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import PatternFill

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('converter', ROOT / 'convert-schedule.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class ConverterTests(unittest.TestCase):
    def test_partial_week_roster_and_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'export.xlsx'
            book = Workbook()
            sheet = book.active
            sheet.append(['June 21, 2027', None, 'June 22, 2027', None, 'June 23, 2027', None,
                          'June 24, 2027', None, 'June 25, 2027', None, 'June 26, 2027', None, 'June 27, 2027'])
            sheet.append(['Millett (3)', 'CA GOR', None, None, None, None, None, None, None, None, 'Millett (3)', 'CA GOR'])
            sheet['A2'].fill = PatternFill('solid', fgColor='0000FFFF')
            sheet.append(['June 28, 2027', None, 'June 29, 2027', None, 'June 30, 2027'])
            sheet.append(['Millett (3)', 'Senior Day Call', None, None, None, None, None, None, None, None, 'Millett (3)', 'CA Vacation'])
            sheet.append(['Schedule Notes:'])
            sheet.append(['Millett (3)', 'CA Bogus Note'])
            sheet.append(['Last Name', 'First Name', 'Abbr'])
            sheet.append(['Millett', 'Matthew', 'Millett (3)'])
            book.save(source)
            frame, colors = converter.parse_qgenda_excel(source)
            self.assertEqual(set(frame.name), {'Millett, Matthew'})
            self.assertEqual(len(frame), 3)
            self.assertEqual(frame.date.max(), pd.Timestamp('2027-06-28'))
            self.assertNotIn('CA Bogus Note', frame['shift'].tolist())
            self.assertNotIn('CA Vacation', frame['shift'].tolist())
            self.assertEqual(colors['Millett, Matthew'], '0000FFFF')

    def test_preserves_unprefixed_work_deduplicates_and_escapes_names(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'schedule.js'
            name = 'Test "Quote" \\ newline\nName'
            frame = pd.DataFrame([
                {'date': pd.Timestamp('2026-11-09'), 'name': name, 'shift': '7-7'},
                {'date': pd.Timestamp('2026-11-09'), 'name': name, 'shift': '7-7'},
                {'date': pd.Timestamp('2026-11-10'), 'name': 'Resident', 'shift': 'CA GOR'},
                {'date': pd.Timestamp('2026-11-11'), 'name': 'Resident', 'shift': 'New Work'},
            ])
            count = converter.convert_to_javascript(frame, {name: '00FFFF99', 'Resident': '0000FFFF'}, target, Path('export.xlsx'))
            records = [json.loads(line.strip().removesuffix(',')) for line in target.read_text().splitlines() if line.strip().startswith('{')]
            self.assertEqual(count, 3)
            self.assertEqual(records[0]['name'], name)
            self.assertEqual(records[0]['shift'], 'CRNA 7-7')
            self.assertEqual(records[2]['shift'], 'CA New Work')

    def test_empty_or_unrecognized_import_cannot_erase_schedule(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'schedule.js'
            target.write_text('KEEP EXISTING DATA')
            for frame in [pd.DataFrame(), pd.DataFrame([{'date': pd.Timestamp('2026-11-09'), 'name': 'Announcement', 'shift': 'Meeting'}])]:
                with self.assertRaises(ValueError):
                    converter.convert_to_javascript(frame, {}, target, Path('export.xlsx'))
                self.assertEqual(target.read_text(), 'KEEP EXISTING DATA')


if __name__ == '__main__':
    unittest.main()
