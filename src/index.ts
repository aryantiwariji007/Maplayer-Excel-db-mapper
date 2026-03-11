import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initDb } from './db/client';

import schemasRouter from './routes/schemas';
import mapRouter from './routes/map';
import { initQdrant, syncSchemaEmbeddings } from './services/qdrantClient';
import { listAllSchemas } from './services/corrections';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Qdrant and sync schemas
initQdrant().then(() => {
    const schemas = listAllSchemas();
    for (const schema of schemas) {
        syncSchemaEmbeddings(schema).catch(e => console.error("Sync error:", e));
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize DB schema
try {
    initDb();
} catch (err) {
    console.error("Failed to initialize database", err);
    process.exit(1);
}

// Routes
app.use('/schemas', schemasRouter);
app.use('/map', mapRouter);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'MapLayer' });
});

// Start server
app.listen(PORT, () => {
    console.log(`MapLayer API is running on http://localhost:${PORT}`);
});
