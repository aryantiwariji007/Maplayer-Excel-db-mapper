import db, { initDb } from './client';
import { v4 as uuidv4 } from 'uuid';

initDb();
console.log("Seeding test API key...");

const insertClient = db.prepare(`
    INSERT OR IGNORE INTO api_clients (id, client_name, api_key, product_id, rate_limit)
    VALUES (?, ?, ?, ?, ?)
`);

// Example API Key for the 'ScotAI-customer' product
insertClient.run(
    uuidv4(),
    "ScotAI Test Client",
    "maplayer_test_key_123",
    "ScotAI-customer",
    1000
);

console.log("Test API client created successfully!");
console.log("Use Header: Authorization: Bearer maplayer_test_key_123");
console.log("For modifying product_id: ScotAI-customer");
