import { pipeline, env } from '@xenova/transformers';

// Disable downloading models to a cache directory if we want to bundle or just use default cache
// env.allowLocalModels = false; // We use remote models cached locally by default

let embedder: any = null;

export async function initEmbedder() {
    if (!embedder) {
        console.log("Loading all-MiniLM-L6-v2 model...");
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            // quantized: true, // reduce memory usage if needed
        });
        console.log("Model loaded successfully.");
    }
    return embedder;
}

export async function generateEmbedding(text: string): Promise<number[]> {
    const extractor = await initEmbedder();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    // output.data is a Float32Array
    return Array.from(output.data);
}
