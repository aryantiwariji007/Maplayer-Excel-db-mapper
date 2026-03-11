import { ColumnMapping, TransformHint } from '../types';

// In-memory job data store (for prototype). In prod, use Redis or S3.
export interface JobContext {
    rows: Record<string, string>[];
    headers: string[];
    product_id?: string;
    schema_name?: string;
    file_name?: string;
}

const jobDataStore = new Map<string, JobContext>();

export function storeJobData(jobId: string, context: JobContext) {
    jobDataStore.set(jobId, context);
    // Auto-expire after 1 hour (prototype)
    setTimeout(() => jobDataStore.delete(jobId), 3600 * 1000);
}

export function getJobData(jobId: string): JobContext | undefined {
    return jobDataStore.get(jobId);
}

export interface TransformResult {
    rows: Record<string, any>[];
    skipped_rows: Array<{
        row_index: number;
        reason: string;
    }>;
    transform_summary: Record<string, string>;
}

function applyTransform(value: string, transform?: TransformHint): any {
    if (!value) return value;
    if (!transform || transform.type === 'none') return value;

    try {
        switch (transform.type) {
            case 'case_transform':
                return value.toLowerCase();
            case 'number_parse':
                const num = parseFloat(value.replace(/[^0-9.-]+/g, ""));
                return isNaN(num) ? value : num;
            case 'split':
                return value.split(transform.notes || ' ')[0]; // Basic split representation
            case 'date_format':
                return new Date(value).toISOString(); // Naive date transform
            case 'phone_format':
                return value.replace(/\D/g, ''); // Naive digit extraction
            default:
                return value;
        }
    } catch (e) {
        return value; // fall back to original if transform fails
    }
}

export function transformDataset(jobId: string, mappings: ColumnMapping[]): TransformResult {
    const context = jobDataStore.get(jobId);
    if (!context) {
        throw new Error('Data for job not found or expired.');
    }

    const { rows: rawRows } = context;
    const rows: Record<string, any>[] = [];
    const skipped_rows: Array<{ row_index: number; reason: string }> = [];
    const transform_summary: Record<string, string> = {};

    // Build a summary of what's being applied
    mappings.forEach(m => {
        if (m.target_key) {
            transform_summary[m.target_key] = m.transform ? m.transform.type : "none";
        }
    });

    rawRows.forEach((rawRow, idx) => {
        let skip = false;
        let reason = '';
        const transformedRow: Record<string, any> = {};

        for (const mapping of mappings) {
            if (!mapping.target_key) continue;

            const rawVal = rawRow[mapping.source_column];

            // if value is missing but required, we might skip depending on the user's needs.
            // For now, we just pass the transformed value (or undefined).
            if (rawVal !== undefined && rawVal !== null) {
                transformedRow[mapping.target_key] = applyTransform(rawVal, mapping.transform);
            } else {
                transformedRow[mapping.target_key] = null;
            }
        }

        if (!skip) {
            rows.push(transformedRow);
        } else {
            skipped_rows.push({ row_index: idx, reason });
        }
    });

    // Since we transformed, we could remove the job data to save memory, but we keep it till expiration.
    // jobDataStore.delete(jobId);

    return {
        rows,
        skipped_rows,
        transform_summary
    };
}
