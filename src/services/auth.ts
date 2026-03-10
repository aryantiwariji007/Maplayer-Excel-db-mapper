import db from '../db/client';
import { ApiClient } from '../types';

export function getClientByKey(apiKey: string): ApiClient | null {
    const row = db.prepare(`SELECT * FROM api_clients WHERE api_key = ?`).get(apiKey);
    return row ? (row as ApiClient) : null;
}
