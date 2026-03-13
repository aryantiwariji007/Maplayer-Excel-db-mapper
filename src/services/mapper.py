from rapidfuzz import fuzz, utils
from .embedding import generate_embedding
from .qdrant_service import search_semantic_similarity

def _is_generic_header(header: str) -> bool:
    """
    Detects generic/placeholder headers that usually come from empty
    Excel header cells, e.g. 'Unnamed: 0'.
    """
    processed = utils.default_process(header) or ""
    if not processed:
        return True

    generic_prefixes = ("unnamed", "column", "col ")
    return any(processed.startswith(prefix) for prefix in generic_prefixes)

def calculate_alias_score(header: str, expected_key: str, aliases: list[str]) -> float:
    """Calculates the max fuzzy match score against aliases and the key itself."""
    processed_header = utils.default_process(header)
    if not processed_header: return 0.0

    targets = [expected_key] + (aliases if aliases else [])
    
    best_score = 0.0
    for target in targets:
        processed_target = utils.default_process(target)
        if not processed_target: continue

        # Exact match
        if processed_header == processed_target:
            return 1.0

        # Fuzzy match
        score = fuzz.token_sort_ratio(processed_header, processed_target) / 100.0
        best_score = max(best_score, score)

    return best_score

def calculate_text_similarity(header: str, label: str) -> float:
    """Calculates string similarity between header and schema label."""
    processed_header = utils.default_process(header)
    processed_label = utils.default_process(label)
    if not processed_header or not processed_label:
        return 0.0

    return fuzz.token_sort_ratio(processed_header, processed_label) / 100.0

def calculate_datatype_score(inferred_type: str, schema_type: str) -> float:
    """Calculates compatibility between profiled type and schema type."""
    if inferred_type == schema_type:
        return 1.0
        
    # Inferred vs Schema compatibility matrix
    compat_matrix = {
        "text": {"string": 1.0, "email": 0.3, "phone": 0.3, "url": 0.3},
        "string": {"string": 1.0, "text": 1.0, "email": 0.3, "phone": 0.3, "url": 0.3},
        "number": {"number": 1.0, "string": 0.8, "text": 0.8},
        "date": {"date": 1.0, "string": 0.5, "text": 0.5},
        "boolean": {"boolean": 1.0, "string": 0.6, "number": 0.6},
        "email": {"email": 1.0, "string": 0.8},
        "phone": {"phone": 1.0, "string": 0.8},
        "url": {"url": 1.0, "string": 0.8}
    }

    # Normalize types
    inf = inferred_type.lower()
    sch = schema_type.lower()
    
    if inf in compat_matrix and sch in compat_matrix[inf]:
        return compat_matrix[inf][sch]
        
    return 0.1  # Base score for mismatch, since everything *can* be cast to a string often

def score_mapping(
    header: str, 
    inferred_type: str, 
    schema_id: str, 
    fields: list[dict]
) -> tuple[dict, list[dict]]:
    """
    Scores a single column header against all fields in a schema.
    Returns the best match and the list of ambiguities if any.
    """
    results = []
    semantic_cache = None

    if _is_generic_header(header):
        # Treat generic headers as unmapped to avoid confident but meaningless matches
        return None, []

    for field in fields:
        alias_score = calculate_alias_score(header, field["key"], field.get("aliases", []))
        text_similarity = calculate_text_similarity(header, field["label"])
        datatype_score = calculate_datatype_score(inferred_type, field["data_type"])

        # Decide if we need semantic search
        semantic_score = 0.0
        max_base_score = max(alias_score, text_similarity)

        if max_base_score < 0.70:
            if semantic_cache is None:
                # Only compute the embedding once per header if needed
                semantic_cache = {}
                embed = generate_embedding(header)
                s_results = search_semantic_similarity(embed, schema_id, limit=len(fields))
                for res in s_results:
                    semantic_cache[res["target_key"]] = res["score"]

            semantic_score = semantic_cache.get(field["key"], 0.0)

        # Formula
        final_score = (0.40 * alias_score) + \
                      (0.30 * text_similarity) + \
                      (0.15 * datatype_score) + \
                      (0.15 * semantic_score)

        results.append(
            {
                "target_key": field["key"],
                "target_label": field["label"],
                "final_score": final_score,
                "components": {
                    "alias": alias_score,
                    "text": text_similarity,
                    "type": datatype_score,
                    "semantic": semantic_score,
                },
            }
        )

    # Sort results
    results.sort(key=lambda x: x["final_score"], reverse=True)
    
    best_match = results[0] if results else None
    
    # Check for ambiguities (other fields within 0.15 of best match)
    ambiguities = []
    if best_match and best_match["final_score"] < 0.75:
        for r in results[1:]:
            if best_match["final_score"] - r["final_score"] <= 0.15:
                ambiguities.append(r)

    return best_match, ambiguities

def evaluate_best_match(best_match: dict) -> str:
    """Classifies the mapping result based on the final score."""
    if not best_match:
        return "unmapped"
    score = best_match["final_score"]
    if score >= 0.75:
        return "ready"
    elif 0.55 <= score < 0.75:
        return "needs_review"
    else:
        return "unmapped"
