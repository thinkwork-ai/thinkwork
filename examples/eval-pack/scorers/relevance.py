"""Custom scorer: checks if the response is relevant to the input query."""


def score_relevance(test_case: dict, response: dict) -> float:
    """Score how relevant the agent's response is to the input.

    Args:
        test_case: Dict with 'input', 'expected', 'tags', 'metadata'
        response: Dict with 'output' (agent response text), 'latency_ms', 'tools_called'

    Returns:
        Float between 0.0 and 1.0 where 1.0 is perfectly relevant.
    """
    input_text = test_case.get("input", "").lower()
    output_text = response.get("output", "").lower()

    if not output_text:
        return 0.0

    # Extract key terms from input (simple keyword overlap)
    stop_words = {"the", "a", "an", "is", "are", "was", "were", "what", "how", "why",
                  "when", "where", "who", "do", "does", "can", "could", "would", "should",
                  "i", "you", "me", "my", "your", "it", "this", "that", "of", "in", "to",
                  "for", "on", "with", "at", "by", "from", "and", "or", "not", "be"}
    input_terms = {w for w in input_text.split() if w not in stop_words and len(w) > 2}

    if not input_terms:
        return 1.0  # No meaningful terms to check

    # Score based on term overlap
    matches = sum(1 for term in input_terms if term in output_text)
    return min(matches / len(input_terms), 1.0)
