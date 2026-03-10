import { TargetSchema } from '../types';
import { ColumnProfile } from './columnProfiler';
import { normalizeColumnName } from '../utils/normalize';

export interface SchemaDetectionResult {
    best_schema: string | null;
    confidence: number;
}

/**
 * Detects the best matching schema for the given column profiles.
 * It compares the normalized source column names against the target keys,
 * labels, and aliases of each schema.
 */
export function detectBestSchema(
    profiles: ColumnProfile[],
    schemas: TargetSchema[]
): SchemaDetectionResult {
    if (schemas.length === 0 || profiles.length === 0) {
        return { best_schema: null, confidence: 0 };
    }

    let bestSchema: string | null = null;
    let highestConfidence = 0;

    for (const schema of schemas) {
        let matchScore = 0;

        for (const profile of profiles) {
            const normSource = profile.normalized_name;
            let matched = false;

            for (const col of schema.columns) {
                const normKey = normalizeColumnName(col.key);
                const normLabel = normalizeColumnName(col.label);

                // 1. Label/Key/Synonym Match
                if (
                    normSource === normKey ||
                    normSource === normLabel ||
                    (normSource === "name" && normKey === "full name") ||
                    (normSource === "full name" && normKey === "name")
                ) {
                    matched = true;
                    break;
                }

                // 2. Data Type Match (Email, Phone, Date)
                if (col.data_type && col.data_type !== "string" && col.data_type === profile.inferred_type) {
                    matched = true;
                    break;
                }

                // 3. Alias Match
                if (col.aliases) {
                    for (const alias of col.aliases) {
                        if (normSource === normalizeColumnName(alias)) {
                            matched = true;
                            break;
                        }
                    }
                }
            }

            if (matched) matchScore += 1;
        }

        // Divide by schema length so we see how much of our TARGET is covered
        const confidence = parseFloat((matchScore / schema.columns.length).toFixed(2));

        if (confidence > highestConfidence) {
            highestConfidence = confidence;
            bestSchema = schema.schema_name;
        }
    }

    return {
        best_schema: bestSchema,
        confidence: highestConfidence
    };
}
