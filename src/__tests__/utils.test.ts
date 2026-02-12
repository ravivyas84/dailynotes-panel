import { getDateRegex, parseDateFromFilename, formatToday, isToday, filenameToTitle, processNoteFiles } from '../utils';

describe('getDateRegex', () => {
    it('returns regex matching yyyymmdd filenames', () => {
        const regex = getDateRegex('yyyymmdd');
        expect(regex).not.toBeNull();
        expect(regex!.test('20250209.md')).toBe(true);
        expect(regex!.test('20241231.md')).toBe(true);
    });

    it('returns regex matching yyyy-mm-dd filenames', () => {
        const regex = getDateRegex('yyyy-mm-dd');
        expect(regex).not.toBeNull();
        expect(regex!.test('2025-02-09.md')).toBe(true);
        expect(regex!.test('2024-12-31.md')).toBe(true);
    });

    it('rejects non-matching filenames for yyyymmdd', () => {
        const regex = getDateRegex('yyyymmdd');
        expect(regex!.test('2025-02-09.md')).toBe(false);
        expect(regex!.test('notes.md')).toBe(false);
        expect(regex!.test('20250209.txt')).toBe(false);
        expect(regex!.test('2025020.md')).toBe(false);
    });

    it('rejects non-matching filenames for yyyy-mm-dd', () => {
        const regex = getDateRegex('yyyy-mm-dd');
        expect(regex!.test('20250209.md')).toBe(false);
        expect(regex!.test('notes.md')).toBe(false);
        expect(regex!.test('2025-02-09.txt')).toBe(false);
        expect(regex!.test('25-02-09.md')).toBe(false);
    });

    it('returns null for unsupported format', () => {
        expect(getDateRegex('dd-mm-yyyy' as any)).toBeNull();
    });
});

describe('parseDateFromFilename', () => {
    it('parses yyyymmdd format correctly', () => {
        const date = parseDateFromFilename('20250209', 'yyyymmdd');
        expect(date.getFullYear()).toBe(2025);
        expect(date.getMonth()).toBe(1); // 0-indexed: January=0, February=1
        expect(date.getDate()).toBe(9);
    });

    it('parses yyyy-mm-dd format correctly', () => {
        const date = parseDateFromFilename('2025-02-09', 'yyyy-mm-dd');
        expect(date.getFullYear()).toBe(2025);
        expect(date.getMonth()).toBe(1);
        expect(date.getDate()).toBe(9);
    });

    it('parses end of year dates', () => {
        const date = parseDateFromFilename('2024-12-31', 'yyyy-mm-dd');
        expect(date.getFullYear()).toBe(2024);
        expect(date.getMonth()).toBe(11);
        expect(date.getDate()).toBe(31);
    });

    it('returns Invalid Date for malformed input', () => {
        const date = parseDateFromFilename('not-a-date', 'yyyy-mm-dd');
        expect(isNaN(date.getTime())).toBe(true);
    });
});

describe('formatToday', () => {
    it('formats today in yyyymmdd format', () => {
        const result = formatToday('yyyymmdd');
        expect(result).toMatch(/^\d{8}$/);
    });

    it('formats today in yyyy-mm-dd format', () => {
        const result = formatToday('yyyy-mm-dd');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('produces a parseable date string for yyyymmdd', () => {
        const formatted = formatToday('yyyymmdd');
        const parsed = parseDateFromFilename(formatted, 'yyyymmdd');
        expect(isToday(parsed)).toBe(true);
    });

    it('produces a parseable date string for yyyy-mm-dd', () => {
        const formatted = formatToday('yyyy-mm-dd');
        const parsed = parseDateFromFilename(formatted, 'yyyy-mm-dd');
        expect(isToday(parsed)).toBe(true);
    });
});

describe('isToday', () => {
    it('returns true for today', () => {
        expect(isToday(new Date())).toBe(true);
    });

    it('returns false for yesterday', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        expect(isToday(yesterday)).toBe(false);
    });

    it('returns false for a past date', () => {
        expect(isToday(new Date('2020-01-01'))).toBe(false);
    });
});

describe('filenameToTitle', () => {
    it('converts hyphenated filename to title', () => {
        expect(filenameToTitle('my-daily-note')).toBe('My Daily Note');
    });

    it('converts underscored filename to title', () => {
        expect(filenameToTitle('my_daily_note')).toBe('My Daily Note');
    });

    it('converts mixed separators', () => {
        expect(filenameToTitle('my-daily_note')).toBe('My Daily Note');
    });

    it('handles single word', () => {
        expect(filenameToTitle('notes')).toBe('Notes');
    });

    it('handles uppercase input', () => {
        expect(filenameToTitle('MY-NOTE')).toBe('My Note');
    });

    it('handles date-like filenames', () => {
        expect(filenameToTitle('2025-02-09')).toBe('2025 02 09');
    });
});

describe('processNoteFiles', () => {
    it('filters and sorts yyyy-mm-dd note files newest first', () => {
        const files = ['2025-02-09.md', 'readme.md', '2025-01-15.md', '2025-02-01.md', 'notes.txt'];
        const result = processNoteFiles(files, 'yyyy-mm-dd', '/tmp/notes');

        expect(result).toHaveLength(3);
        expect(result[0].filename).toBe('2025-02-09.md');
        expect(result[1].filename).toBe('2025-02-01.md');
        expect(result[2].filename).toBe('2025-01-15.md');
    });

    it('filters and sorts yyyymmdd note files newest first', () => {
        const files = ['20250209.md', 'readme.md', '20250115.md', '20250201.md'];
        const result = processNoteFiles(files, 'yyyymmdd', '/tmp/notes');

        expect(result).toHaveLength(3);
        expect(result[0].filename).toBe('20250209.md');
        expect(result[1].filename).toBe('20250201.md');
        expect(result[2].filename).toBe('20250115.md');
    });

    it('returns empty array for no matching files', () => {
        const files = ['readme.md', 'notes.txt', 'todo.md'];
        const result = processNoteFiles(files, 'yyyy-mm-dd', '/tmp/notes');
        expect(result).toHaveLength(0);
    });

    it('returns empty array for empty file list', () => {
        const result = processNoteFiles([], 'yyyy-mm-dd', '/tmp/notes');
        expect(result).toHaveLength(0);
    });

    it('sets fullPath correctly', () => {
        const files = ['2025-02-09.md'];
        const result = processNoteFiles(files, 'yyyy-mm-dd', '/tmp/notes');
        expect(result[0].fullPath).toContain('2025-02-09.md');
        expect(result[0].fullPath).toContain('/tmp/notes');
    });

    it('parses dates correctly in returned notes', () => {
        const files = ['2025-02-09.md'];
        const result = processNoteFiles(files, 'yyyy-mm-dd', '/tmp/notes');
        expect(result[0].date.getFullYear()).toBe(2025);
        expect(result[0].date.getMonth()).toBe(1);
        expect(result[0].date.getDate()).toBe(9);
    });
});
