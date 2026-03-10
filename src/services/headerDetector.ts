export interface HeaderDetectionResult {
    headerRowIndex: number;
    dataStartIndex: number;
}

/**
 * Detects the true header row within the first 5 rows of a dataset.
 *
 * Logic:
 * - Examine top 5 rows
 * - Choose the row with the highest ratio of non-empty, short string cells
 * - Exclude rows with very long sentences (title/description rows)
 * - Exclude rows that look like merged cell artifacts (very sparse with long labels)
 */
export function detectHeaders(rows: string[][]): HeaderDetectionResult {
    const MAX_INSPECT_ROWS = 5;
    const checkRows = rows.slice(0, MAX_INSPECT_ROWS);

    let bestHeaderIndex = 0;
    let highestScore = -1;

    for (let i = 0; i < checkRows.length; i++) {
        const row = checkRows[i];
        if (!row || row.length === 0) continue;

        let nonEmptyCount = 0;
        let hasLongText = false;
        let longStringCount = 0;
        let shortStringCount = 0;

        for (const cell of row) {
            const cellStr = String(cell).trim();
            if (cellStr === "") continue;
            nonEmptyCount++;

            if (cellStr.length > 80) {
                hasLongText = true; // sentence-like content is a strong signal this isn't a header
            }

            if (cellStr.length > 30) {
                longStringCount++;
            } else {
                shortStringCount++;
            }
        }

        if (nonEmptyCount === 0) continue;

        const fillRatio = nonEmptyCount / row.length;

        // Title rows usually have very long strings or very few values
        const longTextRatio = longStringCount / nonEmptyCount;
        const isMergedArtifact = longTextRatio > 0.5 && fillRatio < 0.4;

        if (hasLongText || isMergedArtifact) continue;

        // Score: favor rows with high fill ratio and mostly short strings
        const score = fillRatio + (shortStringCount / Math.max(row.length, 1));
        if (score > highestScore) {
            highestScore = score;
            bestHeaderIndex = i;
        }
    }

    return {
        headerRowIndex: bestHeaderIndex,
        dataStartIndex: bestHeaderIndex + 1
    };
}
