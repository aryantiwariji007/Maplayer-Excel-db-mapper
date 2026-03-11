import { QdrantClient } from '@qdrant/js-client-rest';
import { TargetSchema } from '../types';
import { generateEmbedding } from './embeddingGenerator';
import { normalizeColumnName } from '../utils/normalize';

const COLLECTION_NAME = 'maplayer_schemas';
const VECTOR_SIZE = 384; // all-MiniLM-L6-v2 outputs 384 dimensions

const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://127.0.0.1:6333' });

/**
 * Ensures the Qdrant collection exists.
 */
export async function initQdrant() {
    try {
        const result = await qdrant.getCollections();
        const exists = result.collections.some(c => c.name === COLLECTION_NAME);
        if (!exists) {
            console.log(`Creating Qdrant collection: ${COLLECTION_NAME}`);
            await qdrant.createCollection(COLLECTION_NAME, {
                vectors: {
                    size: VECTOR_SIZE,
                    distance: 'Cosine'
                }
            });
            // Create payload index for fast filtering by schema_id
            await qdrant.createPayloadIndex(COLLECTION_NAME, {
                field_name: "schema_id",
                field_schema: "keyword"
            });
        }
    } catch (e: any) {
        console.error("Failed to initialize Qdrant:", e.message);
    }
}

/**
 * Precomputes embeddings for all fields in a schema and stores them in Qdrant.
 */
export async function syncSchemaEmbeddings(schema: TargetSchema) {
    console.log(`Syncing embeddings for schema: ${schema.id}`);
    
    try {
        // First, delete any existing points for this schema
        await qdrant.delete(COLLECTION_NAME, {
            filter: {
                must: [{ key: "schema_id", match: { value: schema.id } }]
            }
        });

        const points = [];

        // Compute embeddings for all target columns
        for (const col of schema.columns) {
            const textToEmbed = col.label || col.key;
            const normalized = normalizeColumnName(textToEmbed);
            
            try {
                const vector = await generateEmbedding(normalized);
                points.push({
                    id: crypto.randomUUID(),
                    vector,
                    payload: {
                        schema_id: schema.id,
                        target_key: col.key,
                        label: col.label
                    }
                });
            } catch (e: any) {
                console.error(`Failed to generate embedding locally for ${col.key}:`, e.message);
            }
        }

        if (points.length > 0) {
            await qdrant.upsert(COLLECTION_NAME, {
                wait: true,
                points
            });
            console.log(`Synced ${points.length} fields to Qdrant for schema ${schema.id}.`);
        }
    } catch (e: any) {
        console.error(`Qdrant sync failed for schema ${schema.id}:`, e.message);
        console.error("Make sure Qdrant is running at", process.env.QDRANT_URL || 'http://localhost:6333');
    }
}

export interface SemanticSearchResult {
    target_key: string;
    score: number;
}

/**
 * Searches for the semantically closest schema field.
 */
export async function searchSemanticSimilarity(
    columnEmbedding: number[], 
    schema_id: string, 
    limit: number = 1
): Promise<SemanticSearchResult[]> {
    try {
        const results = await qdrant.search(COLLECTION_NAME, {
            vector: columnEmbedding,
            limit,
            filter: {
                must: [{ key: "schema_id", match: { value: schema_id } }]
            }
        });

        return results.map(r => ({
            target_key: r.payload?.target_key as string,
            score: r.score
        }));
    } catch (e: any) {
        console.error("Qdrant search failed:", e.message);
        return [];
    }
}
