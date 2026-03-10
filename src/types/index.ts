declare global {
    namespace Express {
        interface Request {
            client?: ApiClient;
        }
    }
}

export interface ApiClient {
    id: string;
    client_name: string;
    api_key: string;
    product_id: string;
    rate_limit: number;
    created_at: string;
}

export interface TargetColumn {
    key: string;
    label: string;
    description?: string;
    data_type?: string;
    required?: boolean;
    aliases?: string[];
}

export interface TargetSchema {
    id: string;
    product_id: string;
    schema_name: string;
    description: string;
    columns: TargetColumn[];
    created_at: string;
    updated_at: string;
}

export interface CorrectionRecord {
    id: string;
    product_id: string;
    schema_id: string;
    source_column_name: string;
    correct_target_key: string;
    incorrect_target_key?: string;
    occurrence_count: number;
    created_at: string;
    last_seen_at: string;
}

export interface TransformHint {
    type: "date_format" | "phone_format" | "case_transform" | "number_parse" | "split" | "none";
    from_format?: string;
    to_format?: string;
    notes?: string;
}

export interface ColumnMapping {
    source_column: string;
    target_key: string | null;
    confidence: number;
    requires_review: boolean;
    transform?: TransformHint;
    reasoning?: string;
}

export interface AmbiguityCandidate {
    target_key: string;
    confidence: number;
    reasoning: string;
}

export interface Ambiguity {
    source_column: string;
    candidates: AmbiguityCandidate[];
}

export interface MappingResult {
    job_id: string;
    schema_id: string;
    source_file_name: string;
    source_columns: string[];
    mappings: ColumnMapping[];
    unmapped_source_columns: string[];
    missing_required_columns: string[];
    row_count: number;
    sample_rows: Record<string, string>[];
    ambiguities: Ambiguity[];
    status: "ready" | "needs_review" | "incomplete";
}

export interface MapOptions {
    confidence_threshold?: number;
    max_header_rows?: number;
    sample_row_count?: number;
}
