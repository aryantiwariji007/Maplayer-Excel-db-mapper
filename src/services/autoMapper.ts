import { TargetSchema, ColumnMapping, MapOptions } from '../types';
import { ColumnProfile } from './columnProfiler';
import { normalizeColumnName } from '../utils/normalize';
import { distance } from 'fastest-levenshtein';
import { generateEmbedding } from './embeddingGenerator';
import { searchSemanticSimilarity } from './qdrantClient';

function stringSimilarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    const d = distance(s1, s2);
    return 1 - (d / maxLen);
}

function calculateDataTypeScore(inferredType: string, schemaType?: string): number {
    if (!schemaType || schemaType === "string") return 0.5; // neutral fallback
    if (inferredType === schemaType) return 1.0;
    return 0.1; // mismatch penalty
}

export async function performAutoMapping(
    schema: TargetSchema,
    profiles: ColumnProfile[],
    options: MapOptions = {}
): Promise<ColumnMapping[]> {
    const results: ColumnMapping[] = [];

    for (const profile of profiles) {
        const sourceHeader = profile.column_name;
        const normSource = normalizeColumnName(sourceHeader);
        
        let bestTargetKey: string | null = null;
        let bestScore = 0;
        let maxPrefixScoreForSource = 0; // tracking max(alias_score, text_similarity)

        for (const col of schema.columns) {
            const normKey = normalizeColumnName(col.key);
            const normLabel = normalizeColumnName(col.label);

            // 1. Alias Match
            let aliasScore = 0;
            if (col.aliases && col.aliases.length > 0) {
                for (const alias of col.aliases) {
                    const normAlias = normalizeColumnName(alias);
                    if (normSource === normAlias) {
                        aliasScore = 1.0;
                        break;
                    }
                    const sim = stringSimilarity(normSource, normAlias);
                    if (sim > aliasScore) {
                        aliasScore = sim;
                    }
                }
            } else if (normSource === normKey || normSource === normLabel) {
                 aliasScore = 1.0;
            }

            // 2. String Similarity
            const textSimLabel = stringSimilarity(normSource, normLabel);
            const textSimKey = stringSimilarity(normSource, normKey);
            const textSimilarity = Math.max(textSimLabel, textSimKey);

            // 3. Data Type Match
            const datatypeScore = calculateDataTypeScore(profile.inferred_type, col.data_type);

            // Track maximum structural match to see if semantics are needed later
            const prefixScore = Math.max(aliasScore, textSimilarity);
            if (prefixScore > maxPrefixScoreForSource) {
                maxPrefixScoreForSource = prefixScore;
            }

            // Initial scoring without semantics
            const partialScore = (0.40 * aliasScore) + (0.30 * textSimilarity) + (0.15 * datatypeScore);
            
            if (partialScore > bestScore) {
                bestScore = partialScore;
                bestTargetKey = col.key;
            }
        }

        let finalTargetKey = bestTargetKey;
        let finalScore = bestScore;

        // 4. Semantic Similarity (Embeddings) -- ONLY if needed
        if (maxPrefixScoreForSource < 0.70) {
            try {
                const vector = await generateEmbedding(normSource);
                const semanticResult = await searchSemanticSimilarity(vector, schema.id, 1);
                
                if (semanticResult.length > 0) {
                    const { target_key, score: semanticScore } = semanticResult[0];
                    
                    // We need to re-evaluate the full formula for the top semantic hit to see if it beats the previous best
                    const matchedCol = schema.columns.find(c => c.key === target_key);
                    if (matchedCol) {
                        const normKey = normalizeColumnName(matchedCol.key);
                        const normLabel = normalizeColumnName(matchedCol.label);
                        
                        let aliasScore = 0;
                        if (matchedCol.aliases) {
                            for (const alias of matchedCol.aliases) {
                                const sim = stringSimilarity(normSource, normalizeColumnName(alias));
                                if (sim > aliasScore) aliasScore = sim;
                                if (sim === 1.0) break;
                            }
                        } else if (normSource === normKey || normSource === normLabel) {
                            aliasScore = 1.0;
                        }

                        const textSim = Math.max(stringSimilarity(normSource, normLabel), stringSimilarity(normSource, normKey));
                        const dtScore = calculateDataTypeScore(profile.inferred_type, matchedCol.data_type);

                        const recomputedFinal = (0.40 * aliasScore) + (0.30 * textSim) + (0.15 * dtScore) + (0.15 * semanticScore);
                        
                        // If semantic match results in a better overall score
                        if (recomputedFinal > bestScore) {
                            finalScore = recomputedFinal;
                            finalTargetKey = target_key;
                        }
                    }
                }
            } catch (e) {
                console.error(`Embedding fallback failed for ${sourceHeader}:`, e);
            }
        }

        // Decision thresholds
        let requires_review = false;
        let mapped_to = null;

        if (finalScore >= 0.75) {
            mapped_to = finalTargetKey;
        } else if (finalScore >= 0.55 && finalScore < 0.75) {
            mapped_to = finalTargetKey;
            requires_review = true;
        } else {
            mapped_to = null; // Unmapped
        }

        results.push({
            source_column: sourceHeader,
            target_key: mapped_to,
            confidence: parseFloat(finalScore.toFixed(2)),
            requires_review
        });
    }

    return results;
}
