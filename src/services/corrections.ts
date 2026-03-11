import db from '../db/client';
import { TargetSchema, TargetColumn, CorrectionRecord } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function createSchema(schemaData: Omit<TargetSchema, 'id' | 'created_at' | 'updated_at'>): TargetSchema {
    const id = uuidv4();
    const now = new Date().toISOString();

    const insertSchema = db.prepare(`
    INSERT INTO target_schemas (id, product_id, schema_name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

    const insertColumn = db.prepare(`
    INSERT INTO target_columns (schema_id, key, label, description, data_type, required, aliases)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

    const transaction = db.transaction(() => {
        insertSchema.run(
            id,
            schemaData.product_id,
            schemaData.schema_name,
            schemaData.description,
            now,
            now
        );

        for (const col of schemaData.columns) {
            insertColumn.run(
                id,
                col.key,
                col.label,
                col.description || null,
                col.data_type || "string",
                col.required ? 1 : 0,
                col.aliases ? JSON.stringify(col.aliases) : null
            );
        }
    });

    transaction();

    return {
        ...schemaData,
        id,
        created_at: now,
        updated_at: now
    };
}

export function listSchemas(product_id: string): TargetSchema[] {
    const schemas = db.prepare(`SELECT * FROM target_schemas WHERE product_id = ?`).all(product_id) as any[];
    return schemas.map(schema => {
        const cols = db.prepare(`SELECT * FROM target_columns WHERE schema_id = ?`).all(schema.id) as any[];
        return {
            ...schema,
            columns: cols.map(c => ({
                ...c,
                required: Boolean(c.required),
                examples: c.examples ? JSON.parse(c.examples) : undefined,
                aliases: c.aliases ? JSON.parse(c.aliases) : undefined
            }))
        };
    });
}

export function listAllSchemas(): TargetSchema[] {
    const schemas = db.prepare(`SELECT * FROM target_schemas`).all() as any[];
    return schemas.map(schema => {
        const cols = db.prepare(`SELECT * FROM target_columns WHERE schema_id = ?`).all(schema.id) as any[];
        return {
            ...schema,
            columns: cols.map(c => ({
                ...c,
                required: Boolean(c.required),
                examples: c.examples ? JSON.parse(c.examples) : undefined,
                aliases: c.aliases ? JSON.parse(c.aliases) : undefined
            }))
        };
    });
}


export function getSchema(product_id: string, schema_name: string): TargetSchema | null {
    const schema = db.prepare(`SELECT * FROM target_schemas WHERE product_id = ? AND schema_name = ?`).get(product_id, schema_name) as any;
    if (!schema) return null;

    const cols = db.prepare(`SELECT * FROM target_columns WHERE schema_id = ?`).all(schema.id) as any[];
    return {
        ...schema,
        columns: cols.map(c => ({
            ...c,
            required: Boolean(c.required),
            examples: c.examples ? JSON.parse(c.examples) : undefined,
            aliases: c.aliases ? JSON.parse(c.aliases) : undefined
        }))
    };
}

export function updateSchema(product_id: string, schema_name: string, schemaData: Omit<TargetSchema, 'id' | 'created_at' | 'updated_at'>): TargetSchema | null {
    const existing = getSchema(product_id, schema_name);
    if (!existing) return null;

    const now = new Date().toISOString();

    const updateSchemaStmt = db.prepare(`
    UPDATE target_schemas SET description = ?, updated_at = ?
    WHERE id = ?
  `);

    const deleteCols = db.prepare(`DELETE FROM target_columns WHERE schema_id = ?`);
    const insertColumn = db.prepare(`
    INSERT INTO target_columns (schema_id, key, label, description, data_type, required, aliases)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

    const transaction = db.transaction(() => {
        updateSchemaStmt.run(schemaData.description, now, existing.id);
        deleteCols.run(existing.id);

        for (const col of schemaData.columns) {
            insertColumn.run(
                existing.id,
                col.key,
                col.label,
                col.description || null,
                col.data_type || "string",
                col.required ? 1 : 0,
                col.aliases ? JSON.stringify(col.aliases) : null
            );
        }
    });

    transaction();

    return getSchema(product_id, schema_name);
}

export function deleteSchema(product_id: string, schema_name: string): boolean {
    const info = db.prepare(`DELETE FROM target_schemas WHERE product_id = ? AND schema_name = ?`).run(product_id, schema_name);
    return info.changes > 0;
}

export function getCorrections(product_id: string, schema_id: string): CorrectionRecord[] {
    return db.prepare(`
    SELECT * FROM correction_records 
    WHERE product_id = ? AND schema_id = ?
  `).all(product_id, schema_id) as CorrectionRecord[];
}

export function upsertCorrection(
    product_id: string,
    schema_id: string,
    source_column: string,
    correct_target_key: string,
    incorrect_target_key?: string
): void {
    const normalizedSource = source_column.toLowerCase().trim();
    const existing = db.prepare(`
    SELECT id, occurrence_count FROM correction_records
    WHERE product_id = ? AND schema_id = ? AND source_column_name = ? AND correct_target_key = ?
  `).get(product_id, schema_id, normalizedSource, correct_target_key) as any;

    const now = new Date().toISOString();

    if (existing) {
        db.prepare(`
      UPDATE correction_records 
      SET occurrence_count = occurrence_count + 1, last_seen_at = ?, incorrect_target_key = COALESCE(?, incorrect_target_key)
      WHERE id = ?
    `).run(now, incorrect_target_key || null, existing.id);
    } else {
        db.prepare(`
      INSERT INTO correction_records (id, product_id, schema_id, source_column_name, correct_target_key, incorrect_target_key, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), product_id, schema_id, normalizedSource, correct_target_key, incorrect_target_key || null, now, now);
    }
}
