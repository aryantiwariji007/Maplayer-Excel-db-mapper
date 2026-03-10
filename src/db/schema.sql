CREATE TABLE IF NOT EXISTS target_schemas (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    schema_name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, schema_name)
);

CREATE TABLE IF NOT EXISTS target_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_id TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    data_type TEXT NOT NULL,
    required BOOLEAN NOT NULL DEFAULT 0,
    format_hint TEXT,
    examples TEXT, -- JSON array of strings
    aliases TEXT,  -- JSON array of strings
    FOREIGN KEY(schema_id) REFERENCES target_schemas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS correction_records (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    schema_id TEXT NOT NULL,
    source_column_name TEXT NOT NULL,
    correct_target_key TEXT NOT NULL,
    incorrect_target_key TEXT,
    occurrence_count INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, schema_id, source_column_name, correct_target_key)
);

CREATE TABLE IF NOT EXISTS api_clients (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    product_id TEXT NOT NULL,
    rate_limit INTEGER DEFAULT 1000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
