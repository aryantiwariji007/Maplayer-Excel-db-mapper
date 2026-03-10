import { GoogleGenerativeAI } from '@google/generative-ai';
import { TargetSchema, CorrectionRecord, MapOptions, ColumnMapping, Ambiguity } from '../types';
import { ColumnProfile } from './columnProfiler';

export interface AiMappingResponse {
    mappings: ColumnMapping[];
    ambiguities: Ambiguity[];
    unmapped_source_columns: string[];
    missing_required_columns: string[];
}

/**
 * Calls the AI ONLY for the columns that were not matched by alias matching
 * or correction memory. This minimizes token usage and latency.
 */
export async function getAiMapping(
    schema: TargetSchema,
    unmatchedProfiles: ColumnProfile[],        // only unmatched columns
    alreadyMappedSourceCols: string[],          // already resolved - AI should not re-map these
    corrections: CorrectionRecord[],
    options: MapOptions
): Promise<AiMappingResponse> {

    // If nothing needs AI, return empty
    if (unmatchedProfiles.length === 0) {
        const requiredKeys = schema.columns.filter(c => c.required).map(c => c.key);
        const missing = requiredKeys.filter(k => !alreadyMappedSourceCols.includes(k));
        return {
            mappings: [],
            ambiguities: [],
            unmapped_source_columns: [],
            missing_required_columns: missing
        };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not defined in environment variables.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
        }
    });

    // Prepare sources for AI
    const sourceData = unmatchedProfiles.map(p => ({
        column_name: p.column_name,
        normalized_name: p.normalized_name,
        inferred_type: p.inferred_type,
        samples: p.samples
    }));

    // Build prompt with only the target columns NOT already matched by alias/memory
    const alreadyMappedTargetKeys = alreadyMappedSourceCols;
    const unmappedTargetCols = schema.columns.filter(c => !alreadyMappedTargetKeys.includes(c.key));

    const prompt = `
You are a data schema mapping assistant. Your job is to match source CSV columns to a target database schema.
Return ONLY valid JSON. No markdown, no code fences, no explanations.

TARGET SCHEMA (only the columns that have not already been matched):
${JSON.stringify(unmappedTargetCols, null, 2)}

SOURCE COLUMNS TO MAP (with inferred type and sample values):
${JSON.stringify(sourceData, null, 2)}

PAST CORRECTIONS (previously confirmed mappings - weight these at 0.95 baseline):
${corrections.length > 0 ? JSON.stringify(corrections, null, 2) : "None"}

TASK:
Match each source column to the best target schema column.
For each match return: source_column, target_key (or null), confidence (0.0-1.0), reasoning (1 sentence), and transform if needed.
If confidence difference between top candidates is < 0.15, add to ambiguities.

Return exactly:
{
  "mappings": [{ "source_column": string, "target_key": string | null, "confidence": number, "reasoning": string, "transform": { "type": string } | null }],
  "ambiguities": [{ "source_column": string, "candidates": [{ "target_key": string, "confidence": number, "reasoning": string }] }],
  "unmapped_source_columns": [string],
  "missing_required_columns": [string]
}
`;

    let retries = 2;
    while (retries >= 0) {
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanedText) as AiMappingResponse;

            const threshold = options.confidence_threshold ?? 0.75;
            if (parsed.mappings) {
                parsed.mappings = parsed.mappings.map(m => ({
                    ...m,
                    requires_review: (m.confidence || 0) < threshold
                }));
            }

            return parsed;
        } catch (err) {
            if (retries === 0) throw new Error('AI mapping failed after retries: ' + (err as Error).message);
            retries--;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    throw new Error("Unexpected error in getAiMapping");
}
