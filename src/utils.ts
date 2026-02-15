import { parse, format, isSameDay } from 'date-fns';

export type DateFormatOption = 'yyyymmdd' | 'yyyy-mm-dd';

export interface DailyNote {
    filename: string;
    fullPath: string;
    date: Date;
}

/**
 * Returns the regex that matches daily note filenames for the given date format.
 */
export function getDateRegex(dateFormat: DateFormatOption): RegExp | null {
    if (dateFormat === 'yyyymmdd') {
        return /^\d{8}\.md$/;
    } else if (dateFormat === 'yyyy-mm-dd') {
        return /^\d{4}-\d{2}-\d{2}\.md$/;
    }
    return null;
}

/**
 * Parses a date string extracted from a filename using the given format.
 */
export function parseDateFromFilename(dateString: string, dateFormat: DateFormatOption): Date {
    const formatString = dateFormat === 'yyyymmdd' ? 'yyyyMMdd' : 'yyyy-MM-dd';
    return parse(dateString, formatString, new Date());
}

/**
 * Formats today's date as a string in the given format.
 */
export function formatToday(dateFormat: DateFormatOption): string {
    const formatString = dateFormat === 'yyyymmdd' ? 'yyyyMMdd' : 'yyyy-MM-dd';
    return format(new Date(), formatString);
}

/**
 * Formats an arbitrary date using the configured daily notes filename date format.
 */
export function formatDate(date: Date, dateFormat: DateFormatOption): string {
    const formatString = dateFormat === 'yyyymmdd' ? 'yyyyMMdd' : 'yyyy-MM-dd';
    return format(date, formatString);
}

/**
 * Checks whether two dates fall on the same calendar day.
 */
export function isToday(date: Date): boolean {
    return isSameDay(date, new Date());
}

/**
 * Converts a filename (without extension) into a title-cased heading.
 * Splits on hyphens and underscores, capitalizes each word.
 */
export function filenameToTitle(filename: string): string {
    return filename
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Filters a list of filenames to those matching the date regex,
 * parses them into DailyNote objects, validates dates, and sorts newest-first.
 */
export function processNoteFiles(
    files: string[],
    dateFormat: DateFormatOption,
    folderPath: string
): DailyNote[] {
    const dateRegex = getDateRegex(dateFormat);
    if (!dateRegex) {
        return [];
    }

    const path = require('path');

    return files
        .filter(file => dateRegex.test(file))
        .map(filename => {
            const fullPath = path.join(folderPath, filename);
            const dateString = filename.replace('.md', '');
            const date = parseDateFromFilename(dateString, dateFormat);
            return { filename, fullPath, date };
        })
        .filter(note => !isNaN(note.date.getTime()))
        .sort((a, b) => b.date.getTime() - a.date.getTime());
}
