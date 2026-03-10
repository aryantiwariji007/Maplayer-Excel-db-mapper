import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Connect to SQLite database
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../maplayer.db');
const db = new Database(dbPath, { verbose: console.log });
db.pragma('journal_mode = WAL');

// Initialize database schema
export const initDb = () => {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
    console.log('Database initialized successfully.');
};

export default db;
