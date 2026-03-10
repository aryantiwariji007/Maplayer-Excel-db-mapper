import { Request, Response, NextFunction } from 'express';
import { getClientByKey } from '../services/auth';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Missing or invalid Authorization header", code: "UNAUTHORIZED" });
    }

    const apiKey = authHeader.split(' ')[1];
    const client = getClientByKey(apiKey);

    if (!client) {
        return res.status(401).json({ error: "Invalid API Key", code: "UNAUTHORIZED" });
    }

    // Attach client to request for access in routes
    req.client = client;
    next();
}

/**
 * Ensures the product_id requested matches the client's authorized product_id (unless they are an admin super-key).
 * For MapLayer, the client's product_id is their tenant ID.
 */
export function enforceTenantScope(req: Request, res: Response, next: NextFunction) {
    const client = req.client;
    if (!client) {
        return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    // Check body or params for product_id
    const requestedProductId = req.body.product_id || req.params.product_id || req.query.product_id;

    if (requestedProductId && requestedProductId !== client.product_id) {
        return res.status(403).json({ error: "API Key does not have access to this product_id.", code: "FORBIDDEN" });
    }

    next();
}
