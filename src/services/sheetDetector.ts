import * as xlsx from 'xlsx';

export interface SheetSelectionResult {
    sheetName: string;
    rows: string[][];
}

/**
 * Selects the best sheet from a workbook.
 * Chooses the sheet with the largest non-empty rectangular data block (rows * columns).
 * Ignores sheets that are mostly empty.
 */
export function selectBestSheet(workbook: xlsx.WorkBook): SheetSelectionResult {
    let bestSheetName = workbook.SheetNames[0];
    let bestScore = 0;
    let bestRows: string[][] = [];

    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json<string[]>(worksheet, { header: 1, defval: "" });

        if (rows.length === 0) continue;

        // Determine the max column width
        const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);

        // Count non-empty cells
        let nonEmptyCells = 0;
        for (const row of rows) {
            for (const cell of row) {
                if (cell !== "" && cell !== undefined && cell !== null) nonEmptyCells++;
            }
        }

        const totalCells = rows.length * maxCols;
        if (totalCells === 0) continue;

        const fillRatio = nonEmptyCells / totalCells;

        // Ignore sheets that are less than 20% full (mostly empty)
        if (fillRatio < 0.2) continue;

        // Score = rows * columns (largest data block)
        const score = rows.length * maxCols;
        if (score > bestScore) {
            bestScore = score;
            bestSheetName = sheetName;
            bestRows = rows.map(row => row.map(cell => String(cell)));
        }
    }

    // If all sheets were empty, just use the first sheet
    if (bestRows.length === 0) {
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        bestRows = xlsx.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" })
            .map(row => row.map(cell => String(cell)));
    }

    return { sheetName: bestSheetName, rows: bestRows };
}
