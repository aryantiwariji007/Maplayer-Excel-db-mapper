import { z } from 'zod';

export const ColumnSchema = z.object({
    key: z.string(),
    label: z.string(),
    description: z.string().optional(),
    data_type: z.string().optional(),
    required: z.boolean().optional(),
    aliases: z.array(z.string()).optional()
});

export const TargetSchemaInputSchema = z.object({
    product_id: z.string(),
    schema_name: z.string(),
    description: z.string(),
    columns: z.array(ColumnSchema),
});

export const MapOptionsSchema = z.object({
    confidence_threshold: z.number().optional().default(0.75),
    max_header_rows: z.number().optional().default(3),
    sample_row_count: z.number().optional().default(3),
});

export const ConfirmMappingInputSchema = z.object({
    job_id: z.string(),
    product_id: z.string(),
    schema_id: z.string(),
    confirmed_mappings: z.array(z.object({
        source_column: z.string(),
        target_key: z.string(),
        was_ai_suggestion: z.boolean(),
        ai_suggested_key: z.string().optional(),
    })),
});

export const TransformInputSchema = z.object({
    job_id: z.string(),
    confirmed_mappings: z.array(z.object({
        source_column: z.string(),
        target_key: z.string().nullable(),
        confidence: z.number(),
        requires_review: z.boolean(),
        transform: z.object({
            type: z.enum(["date_format", "phone_format", "case_transform", "number_parse", "split", "none"]),
            from_format: z.string().optional(),
            to_format: z.string().optional(),
            notes: z.string().optional()
        }).optional(),
        reasoning: z.string().optional()
    })),
    // Additional requirement to pass data arrays could be added, or cache the parsed payload.
    // The map endpoints expect to transform the full dataset based on mappings.
    // Since we don't store uploaded files, the user might need to re-upload the file or we handle simple JSON matching?
    // Let's assume the frontend will send the mappings and job_id. Wait, how do we transform the data without the file?
    // The user prompt implies: POST /map returns mapping, UI resolves -> POST /map/confirm + POST /map/transform
    // We'll need to know where the data comes from. The easiest is if /map/transform accepts the file again OR the data array.
    // We'll add data array handling or file upload handling to TransformInputSchema.
});

// Since /map/transform relies on file content and the spec didn't specify file re-upload,
// let's assume it should accept the file via multer and JSON via form-data, like /map.
// Or we can expect it in JSON payload. The spec just says:
// Request body: { job_id: string, confirmed_mappings: ColumnMapping[] }
// I will keep it as specified and expect the raw rows might be cached? But caching isn't spec'd.
// Let's assume we expect the data alongside, or we'll figure it out in the route handler.
