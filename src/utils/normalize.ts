/**
 * Normalizes a column name for consistent matching.
 * 
 * Rules:
 * - lowercase
 * - trim whitespace
 * - replace underscores with spaces
 * - remove punctuation
 */
export function normalizeColumnName(name: string): string {
    if (!name) return "";
    return name
        .toLowerCase()
        .trim()
        .replace(/_/g, " ")
        .replace(/[^\w\s]|_/g, "")   // remove punctuation
        .replace(/\s+/g, " ");       // compact multiple spaces into single space
}
