import { TargetSchema, ColumnMapping } from '../types';
import { ColumnProfile } from './columnProfiler';
import { normalizeColumnName } from '../utils/normalize';

const ALIAS_CONFIDENCE = 0.95;

/**
 * Deterministic alias matching.
 * Checks each source column (by its normalized name) against:
 *  1. target.key (normalized)
 *  2. target.label (normalized)
 *  3. any entry in target.aliases (normalized)
 *
 * Matched columns are returned with confidence = 0.95.
 * Returns the list of mapped columns AND the list of unmatched source columns for the AI to handle.
 */
export interface AliasMatchResult {
    matched: ColumnMapping[];
    unmatchedProfiles: ColumnProfile[];
}

export function runAliasMatching(
    profiles: ColumnProfile[],
    schema: TargetSchema
): AliasMatchResult {
    const matched: ColumnMapping[] = [];
    const unmatchedProfiles: ColumnProfile[] = [];
    const usedTargetKeys = new Set<string>();

    for (const profile of profiles) {
        const norm = profile.normalized_name;
        let foundMatch: ColumnMapping | null = null;

        for (const col of schema.columns) {
            if (usedTargetKeys.has(col.key)) continue; // already mapped to something

            const normKey = normalizeColumnName(col.key);
            const normLabel = normalizeColumnName(col.label);

            // 1. Match against target key
            if (norm === normKey) {
                foundMatch = {
                    source_column: profile.column_name,
                    target_key: col.key,
                    confidence: ALIAS_CONFIDENCE,
                    requires_review: false,
                    reasoning: `Exact key match: "${profile.column_name}" normalized to "${norm}" matched target key "${col.key}"`
                };
                break;
            }

            // 2. Match against target label
            if (norm === normLabel) {
                foundMatch = {
                    source_column: profile.column_name,
                    target_key: col.key,
                    confidence: ALIAS_CONFIDENCE,
                    requires_review: false,
                    reasoning: `Label match: "${profile.column_name}" normalized to "${norm}" matched target label "${col.label}"`
                };
                break;
            }

            // 3. Match against aliases
            if (col.aliases && col.aliases.length > 0) {
                for (const alias of col.aliases) {
                    if (norm === normalizeColumnName(alias)) {
                        foundMatch = {
                            source_column: profile.column_name,
                            target_key: col.key,
                            confidence: ALIAS_CONFIDENCE,
                            requires_review: false,
                            reasoning: `Alias match: "${profile.column_name}" matched alias "${alias}" for target "${col.key}"`
                        };
                        break;
                    }
                }
                if (foundMatch) break;
            }
        }

        if (foundMatch) {
            usedTargetKeys.add(foundMatch.target_key!);
            matched.push(foundMatch);
        } else {
            unmatchedProfiles.push(profile);
        }
    }

    return { matched, unmatchedProfiles };
}
