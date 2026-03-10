import { Router } from 'express';
import { TargetSchemaInputSchema } from '../validation/schemas';
import { createSchema, listSchemas, getSchema, updateSchema, deleteSchema } from '../services/corrections';

const router = Router();

// POST /schemas
router.post('/', (req, res) => {
    try {
        const data = TargetSchemaInputSchema.parse(req.body);
        // check if exists
        const existing = getSchema(data.product_id, data.schema_name);
        if (existing) {
            return res.status(400).json({
                error: "Schema already exists",
                code: "VALIDATION_ERROR"
            });
        }

        const created = createSchema(data);
        res.status(201).json(created);
    } catch (error: any) {
        res.status(400).json({ error: error.message, code: "VALIDATION_ERROR", details: error });
    }
});

// GET /schemas/:product_id
router.get('/:product_id', (req, res) => {
    try {
        const schemas = listSchemas(req.params.product_id);
        res.json(schemas);
    } catch (error: any) {
        res.status(500).json({ error: error.message, code: "SCHEMA_NOT_FOUND" });
    }
});

// GET /schemas/:product_id/:schema_name
router.get('/:product_id/:schema_name', (req, res) => {
    try {
        const schema = getSchema(req.params.product_id, req.params.schema_name);
        if (!schema) {
            return res.status(404).json({ error: "Schema not found", code: "SCHEMA_NOT_FOUND" });
        }
        res.json(schema);
    } catch (error: any) {
        res.status(500).json({ error: error.message, code: "SCHEMA_NOT_FOUND" });
    }
});

// PUT /schemas/:product_id/:schema_name
router.put('/:product_id/:schema_name', (req, res) => {
    try {
        const data = TargetSchemaInputSchema.parse(req.body);
        if (data.product_id !== req.params.product_id || data.schema_name !== req.params.schema_name) {
            return res.status(400).json({ error: "Path params must match body", code: "VALIDATION_ERROR" });
        }

        const updated = updateSchema(req.params.product_id, req.params.schema_name, data);
        if (!updated) {
            return res.status(404).json({ error: "Schema not found", code: "SCHEMA_NOT_FOUND" });
        }

        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message, code: "VALIDATION_ERROR", details: error });
    }
});

// DELETE /schemas/:product_id/:schema_name
router.delete('/:product_id/:schema_name', (req, res) => {
    try {
        const deleted = deleteSchema(req.params.product_id, req.params.schema_name);
        if (!deleted) {
            return res.status(404).json({ error: "Schema not found", code: "SCHEMA_NOT_FOUND" });
        }
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message, code: "SCHEMA_NOT_FOUND" });
    }
});

export default router;
