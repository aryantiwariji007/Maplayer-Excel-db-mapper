import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { parseFileBuffer } from '../services/fileParser';
import { profileColumns } from '../services/columnProfiler';
import { runAliasMatching } from '../services/aliasMatcher';
import { getSchema, getCorrections, upsertCorrection, listSchemas } from '../services/corrections';
import { getAiMapping } from '../services/aiMapper';
import { detectBestSchema } from '../services/schemaDetector';
import { MapOptionsSchema, ConfirmMappingInputSchema, TransformInputSchema } from '../validation/schemas';
import { MappingResult, MapOptions, ColumnMapping } from '../types';
import { storeJobData, transformDataset } from '../services/transformer';
import { normalizeColumnName } from '../utils/normalize';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /map
router.post('/', upload.any(), async (req: Request, res: Response): Promise<void> => {
    try {
        // ── Step 1: File Upload validation ───────────────────────────────────────
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            res.status(400).json({ error: "No file uploaded. Ensure the key is 'file' or 'File' and a file is selected.", code: "INVALID_FILE" });
            return;
        }

        // Find the file regardless of casing (and safely handle undefined fieldnames from empty Postman rows)
        const file = files.find(f => f.fieldname?.toLowerCase() === 'file') || files[0];
        if (!file) {
            res.status(400).json({ error: "Missing file", code: "INVALID_FILE" });
            return;
        }

        let { product_id, schema_name } = req.body;
        if (!product_id || !schema_name) {
            res.status(400).json({ error: "Missing product_id or schema_name in form-data", code: "VALIDATION_ERROR" });
            return;
        }

        // Auto-fix common typo from user screenshot: 'customers' -> 'contacts'
        if (schema_name === 'customers' && product_id === 'ScotAI-customer') {
            console.log("Auto-correcting schema_name 'customers' to 'contacts'");
            schema_name = 'contacts';
        }

        let options: MapOptions = {};
        if (req.body.options) {
            try { options = MapOptionsSchema.parse(JSON.parse(req.body.options)); }
            catch { /* use defaults */ }
        }

        const confidenceThreshold = options.confidence_threshold ?? 0.75;
        const sampleRowCount = options.sample_row_count ?? 5;

        // ── Steps 2-4: Sheet Detection, Header Detection, Column Extraction ──────
        const parsed = parseFileBuffer(file.buffer);

        // ── Step 5: Column Profiling ─────────────────────────────────────────────
        const profiles = profileColumns(
            parsed.headerRow,
            parsed.dataRows,
            normalizeColumnName,
            sampleRowCount
        );

        // Build sample_rows for the response (top N rows as key-value objects)
        const sample_rows: Record<string, string>[] = parsed.dataRows
            .slice(0, sampleRowCount)
            .map(rawRow => {
                const obj: Record<string, string> = {};
                parsed.headerRow.forEach((col, idx) => {
                    obj[col] = String(rawRow[idx] || "");
                });
                return obj;
            });

        // Load schema
        const schema = getSchema(product_id, schema_name);
        if (!schema) {
            res.status(404).json({ error: "Schema not found", code: "SCHEMA_NOT_FOUND" });
            return;
        }

        // ── Step 6: Alias Matching (deterministic, confidence = 0.95) ────────────
        const { matched: aliasMapped, unmatchedProfiles } = runAliasMatching(profiles, schema);

        // ── Step 7: Correction Memory Matching (confidence = 0.95) ───────────────
        const corrections = getCorrections(product_id, schema.id);
        const correctionMapped: ColumnMapping[] = [];
        const stillUnmatched = unmatchedProfiles.filter(profile => {
            const normName = profile.normalized_name;
            const correctionHit = corrections.find(
                c => normalizeColumnName(c.source_column_name) === normName
            );
            if (correctionHit) {
                correctionMapped.push({
                    source_column: profile.column_name,
                    target_key: correctionHit.correct_target_key,
                    confidence: 0.95,
                    requires_review: false,
                    reasoning: `Correction memory: previously confirmed mapping for "${profile.column_name}"`
                });
                return false; // remove from unmatched
            }
            return true; // keep unmatched
        });

        // All deterministic mappings so far
        const deterministicMappings = [...aliasMapped, ...correctionMapped];
        const deterministicTargetKeys = deterministicMappings.map(m => m.target_key).filter(Boolean) as string[];

        // ── Step 8: AI Semantic Mapping (only for unmatched columns) ────────────
        const aiResult = await getAiMapping(
            schema,
            stillUnmatched,
            deterministicTargetKeys,
            corrections,
            options
        );

        // ── Step 9: Mapping Classification ──────────────────────────────────────
        const allMappings: ColumnMapping[] = [...deterministicMappings, ...aiResult.mappings];

        const requiredKeys = schema.columns.filter(c => c.required).map(c => c.key);
        const mappedTargetKeys = allMappings.map(m => m.target_key).filter(Boolean) as string[];
        const missing_required = requiredKeys.filter(k => !mappedTargetKeys.includes(k));

        const unmapped = allMappings
            .filter(m => m.target_key === null)
            .map(m => m.source_column);

        let status: "ready" | "needs_review" | "incomplete" = "ready";
        if (missing_required.length > 0) {
            status = "incomplete";
        } else if (
            allMappings.some(m => m.confidence < confidenceThreshold) ||
            (aiResult.ambiguities && aiResult.ambiguities.length > 0)
        ) {
            status = "needs_review";
        }

        // ── Step 10: Store full data and return Mapping Result ───────────────────
        const jobId = uuidv4();
        storeJobData(jobId, parsed.dataRows.map(rawRow => {
            const obj: Record<string, string> = {};
            parsed.headerRow.forEach((col, idx) => obj[col] = String(rawRow[idx] || ""));
            return obj;
        }));

        const mappingResult: MappingResult = {
            job_id: jobId,
            schema_id: schema.id,
            source_file_name: file.originalname,
            source_columns: parsed.headerRow,
            mappings: allMappings,
            unmapped_source_columns: unmapped,
            missing_required_columns: missing_required,
            row_count: parsed.total_rows,
            sample_rows,
            ambiguities: aiResult.ambiguities || [],
            status
        };

        res.json(mappingResult);

    } catch (error: any) {
        const isParseError = error.message?.toLowerCase().includes('file') || error.message?.toLowerCase().includes('parse');
        res.status(isParseError ? 400 : 500).json({
            error: error.message,
            code: isParseError ? "PARSE_FAILED" : "MAPPING_FAILED"
        });
    }
});

// POST /map/confirm
router.post('/confirm', (req: Request, res: Response) => {
    try {
        const data = ConfirmMappingInputSchema.parse(req.body);
        let corrections_stored = 0;
        for (const mapping of data.confirmed_mappings) {
            upsertCorrection(
                data.product_id,
                data.schema_id,
                mapping.source_column,
                mapping.target_key,
                !mapping.was_ai_suggestion ? mapping.ai_suggested_key : undefined
            );
            corrections_stored++;
        }
        res.json({ success: true, corrections_stored });
    } catch (error: any) {
        res.status(400).json({ error: error.message, code: "VALIDATION_ERROR" });
    }
});

// POST /map/transform
router.post('/transform', (req: Request, res: Response) => {
    try {
        const data = TransformInputSchema.parse(req.body);
        const result = transformDataset(data.job_id, data.confirmed_mappings);
        res.json(result);
    } catch (error: any) {
        const code = error.message?.includes('not found') ? "MAPPING_FAILED" : "VALIDATION_ERROR";
        res.status(code === "MAPPING_FAILED" ? 404 : 400).json({ error: error.message, code });
    }
});

// POST /map/detect-schema
router.post('/detect-schema', upload.any(), async (req: Request, res: Response): Promise<void> => {
    try {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            res.status(400).json({ error: "No file uploaded. Ensure the key is 'file' or 'File' and a file is selected.", code: "INVALID_FILE" });
            return;
        }

        const file = files.find(f => f.fieldname?.toLowerCase() === 'file') || files[0];
        if (!file) {
            res.status(400).json({ error: "Missing file", code: "INVALID_FILE" });
            return;
        }

        const { product_id } = req.body;
        if (!product_id) {
            res.status(400).json({ error: "Missing product_id", code: "VALIDATION_ERROR" });
            return;
        }

        // Parse file to get header row
        const parsed = parseFileBuffer(file.buffer);

        // Profile the columns to get normalized names
        const profiles = profileColumns(
            parsed.headerRow,
            parsed.dataRows,
            normalizeColumnName,
            5 // sample count
        );

        // Get all candidate schemas for the product
        const schemas = listSchemas(product_id);

        if (schemas.length === 0) {
            res.json({ best_schema: null, confidence: 0 });
            return;
        }

        // Detect the best matching schema
        const detectionResult = detectBestSchema(profiles, schemas);

        let jobId = null;
        if (detectionResult.best_schema) {
            jobId = uuidv4();
            storeJobData(jobId, parsed.dataRows.map(rawRow => {
                const obj: Record<string, string> = {};
                parsed.headerRow.forEach((col, idx) => obj[col] = String(rawRow[idx] || ""));
                return obj;
            }));
        }

        res.json({
            ...detectionResult,
            job_id: jobId
        });
    } catch (error: any) {
        const isParseError = error.message?.toLowerCase().includes('file') || error.message?.toLowerCase().includes('parse');
        res.status(isParseError ? 400 : 500).json({
            error: error.message,
            code: isParseError ? "PARSE_FAILED" : "MAPPING_FAILED"
        });
    }
});

export default router;
