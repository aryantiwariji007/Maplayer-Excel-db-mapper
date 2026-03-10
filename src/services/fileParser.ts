import * as xlsx from 'xlsx';
import { selectBestSheet } from './sheetDetector';
import { detectHeaders } from './headerDetector';

export interface RawFileData {
    sheetName: string;
    rows: string[][];
    headerRowIndex: number;
    dataStartIndex: number;
    headerRow: string[];
    dataRows: string[][];
    total_rows: number;
}

/**
 * Parses a file buffer into raw structured data.
 * - Reads the workbook
 * - Selects the best sheet (largest data block)
 * - Detects the header row
 * - Returns the raw rows, header row, and data rows separately
 */
export function parseFileBuffer(buffer: Buffer): RawFileData {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const { sheetName, rows } = selectBestSheet(workbook);

    if (rows.length === 0) {
        throw new Error('File is empty or could not be parsed.');
    }

    const { headerRowIndex, dataStartIndex } = detectHeaders(rows);
    const rawHeaderRow = rows[headerRowIndex] || [];

    // Normalize empty header cells to "Column_N"
    const headerRow = rawHeaderRow.map((cell, idx) => {
        const trimmed = String(cell).trim();
        return trimmed === "" ? `Column_${idx + 1}` : trimmed;
    });

    const dataRows = rows.slice(dataStartIndex);
    const total_rows = dataRows.length;

    return {
        sheetName,
        rows,
        headerRowIndex,
        dataStartIndex,
        headerRow,
        dataRows,
        total_rows
    };
}
