export type InferredType = "email" | "phone" | "date" | "url" | "number" | "boolean" | "string";

export interface ColumnProfile {
    column_name: string;
    normalized_name: string;
    samples: string[];
    inferred_type: InferredType;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[+\d][\d\s\-\(\)\.]{6,20}$/;
const dateRegex = /^(\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4})|(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})$/;
const urlRegex = /^https?:\/\/.+/i;
const numberRegex = /^-?[\d,]+(\.\d+)?$/;
const booleanRegex = /^(true|false|yes|no|1|0)$/i;

function inferType(samples: string[]): InferredType {
    const nonEmpty = samples.filter(s => s.trim() !== "");
    if (nonEmpty.length === 0) return "string";

    const counts: Record<InferredType, number> = {
        email: 0, phone: 0, date: 0, url: 0, number: 0, boolean: 0, string: 0
    };

    for (const val of nonEmpty) {
        const v = val.trim();
        if (emailRegex.test(v)) counts.email++;
        else if (urlRegex.test(v)) counts.url++;
        else if (booleanRegex.test(v)) counts.boolean++;
        else if (dateRegex.test(v)) counts.date++;
        else if (numberRegex.test(v)) counts.number++;
        else if (phoneRegex.test(v)) counts.phone++;
        else counts.string++;
    }

    // The type with highest count wins (excluding string as fallback)
    const types: InferredType[] = ["email", "url", "phone", "date", "boolean", "number"];
    let bestType: InferredType = "string";
    let bestCount = 0;

    for (const t of types) {
        // Must match more than 50% of samples to be classified as that type
        if (counts[t] > bestCount && counts[t] / nonEmpty.length > 0.5) {
            bestCount = counts[t];
            bestType = t;
        }
    }

    return bestType;
}

/**
 * Profiles each source column by collecting sample values and inferring the data type.
 */
export function profileColumns(
    columnNames: string[],
    dataRows: string[][],
    normalizeColumnName: (name: string) => string,
    sampleCount: number = 5
): ColumnProfile[] {
    const sampleRows = dataRows.slice(0, sampleCount);

    return columnNames.map((name, idx) => {
        const samples = sampleRows
            .map(row => String(row[idx] || "").trim())
            .filter(v => v !== "");

        return {
            column_name: name,
            normalized_name: normalizeColumnName(name),
            samples,
            inferred_type: inferType(samples)
        };
    });
}
