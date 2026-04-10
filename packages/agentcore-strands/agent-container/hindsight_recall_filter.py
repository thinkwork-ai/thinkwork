"""Post-recall filter for Hindsight results.

PRD-42 follow-up (2026-04-08): Hindsight 0.5.0 recall does not expose a
`score` field and `/consolidate` cannot merge duplicate `world` facts, so
we clean up recall output at the tool layer instead.

Applied in order against the raw `response.results` list from
`_hs_client_ref.recall(...)`:

  1. Top-N pre-cap.
     Recall already orders on-topic facts first (verified on Marco's
     bank with `"Cedric workplace employer"`: items 1-14 were Cedric
     facts, 15-35 were unrelated bleed-through). Truncating early
     prevents the downstream steps from doing O(N^2) work on the tail.

  2. Entity-aware relevance filter.
     Every off-topic result in the Marco reproduction had an `entities`
     array that did not contain any proper-noun token from the query
     (e.g. `["Sapp Bros. Petroleum, Inc.", "WorldLeaks", ...]` vs. a
     query of `"Cedric workplace employer"`). We drop `world` results
     whose `entities` does not intersect with the query's proper nouns.
     `observation` rows have `entities=None` in 0.5.0, so we fall back
     to substring match on `text`.

     If the filter would leave zero results we log a fallback and keep
     the pre-cap list instead, so the agent never gets an empty recall
     just because the query lacks clean proper nouns.

  3. Prefer-observation collapse.
     When two results say the same thing and one of them is an
     `observation` (Hindsight's own consolidation output), keep the
     observation and drop the world fact(s). Observations in the
     Marco data already merge up to 4 source world facts into one
     clean summary (via `source_memory_ids`); 0.5.0 ships a
     proof_count boost (PR #821) that mildly prefers them in
     ranking, and this step makes the preference absolute in our
     post-filter.

  4. Lexical near-duplicate dedup.
     Normalize text — strip trailing `| Involving: ...`, `| When: ...`,
     `| Where: ...` markers, lowercase, normalize unicode hyphens,
     collapse whitespace. Compute token-set Jaccard between each pair
     and drop the later-ranked result when Jaccard >= 0.85. Token-set
     Jaccard is simpler than Levenshtein and good enough for these
     extracted facts which are short and content-word dominated.
     Threshold 0.85 was chosen from Phase 0 pg_trgm data on the 14
     Cedric units: the literal pair is 1.000, the unicode-hyphen
     variant is 0.921, the "production/wines" paraphrase is 0.897,
     and legit distinct facts cluster at 0.60-0.80.

  5. Hard cap.
     Default 8. Long-tail results past this point are rarely useful
     to the agent and eat context budget.

This module is intentionally dependency-free (stdlib only) so it
can run inside the Bedrock AgentCore Strands container without a
Docker rebuild pulling new wheels.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FilterConfig:
    """Knobs for the filter pipeline. Defaults tuned against Marco bank."""

    pre_cap: int = 20
    """Keep only the top-N raw recall results before any processing."""

    dedup_jaccard_threshold: float = 0.85
    """Normalized-text Jaccard above this is considered a duplicate."""

    final_cap: int = 8
    """Hard upper bound on results returned to the agent."""

    min_query_token_length: int = 3
    """Shorter query tokens are dropped as likely stopwords."""

    observation_beats_world_jaccard: float = 0.55
    """If a world fact overlaps this much with an observation, drop the world fact.
    Lower than `dedup_jaccard_threshold` because observations are *summaries*
    and legitimately paraphrase their source world facts."""


DEFAULT_CONFIG = FilterConfig()


# ---------------------------------------------------------------------------
# English stopwords used for proper-noun extraction from query strings.
# Intentionally small — we only need enough to avoid matching on "the",
# "where", "does", etc.
# ---------------------------------------------------------------------------

_STOPWORDS = frozenset(
    {
        "a", "about", "above", "after", "all", "also", "am", "an", "and", "any",
        "are", "as", "at", "be", "because", "been", "before", "being", "between",
        "both", "but", "by", "can", "did", "do", "does", "doing", "down", "during",
        "each", "for", "from", "further", "had", "has", "have", "having", "he",
        "her", "here", "hers", "herself", "him", "himself", "his", "how", "i",
        "if", "in", "into", "is", "it", "its", "itself", "just", "me", "more",
        "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on",
        "once", "only", "or", "other", "our", "ours", "out", "over", "own",
        "same", "she", "should", "so", "some", "such", "than", "that", "the",
        "their", "theirs", "them", "themselves", "then", "there", "these",
        "they", "this", "those", "through", "to", "too", "under", "until", "up",
        "very", "was", "we", "were", "what", "when", "where", "which", "while",
        "who", "whom", "why", "will", "with", "would", "you", "your", "yours",
        "yourself", "yourselves", "tell", "know", "info", "information",
        "about", "me",
    }
)


# ---------------------------------------------------------------------------
# Text normalization
# ---------------------------------------------------------------------------

# Metadata suffixes Hindsight appends to `world` facts like
#   "Cedric is a winemaker at Domaine la Péquélette | Involving: Cedric"
#   "... | When: 2026-03-26"
# We strip these before comparison so literal duplicates that differ only
# in metadata tags collapse together.
_METADATA_SUFFIX_RE = re.compile(
    r"\s*\|\s*(?:involving|when|where|source|tags?)\s*:[^|]*",
    re.IGNORECASE,
)

_WHITESPACE_RE = re.compile(r"\s+")
_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")

# NFKC does not map U+2010 HYPHEN, U+2011 NON-BREAKING HYPHEN, U+2013 EN DASH,
# U+2014 EM DASH, or U+2212 MINUS SIGN to ASCII `-`. Phase 0 found "small‑batch"
# (U+2011) vs "small-batch" (ASCII) as the only difference between two Cedric
# facts that should clearly be treated as identical, so we fold them explicitly.
_DASH_CHARS = str.maketrans({
    "\u2010": "-",  # HYPHEN
    "\u2011": "-",  # NON-BREAKING HYPHEN
    "\u2012": "-",  # FIGURE DASH
    "\u2013": "-",  # EN DASH
    "\u2014": "-",  # EM DASH
    "\u2015": "-",  # HORIZONTAL BAR
    "\u2212": "-",  # MINUS SIGN
})


def _normalize_text(text: str) -> str:
    """Lowercase, strip metadata markers, normalize unicode, collapse whitespace."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_DASH_CHARS)
    text = _METADATA_SUFFIX_RE.sub("", text)
    text = text.lower().strip()
    text = _WHITESPACE_RE.sub(" ", text)
    return text


def _tokenize(text: str) -> frozenset[str]:
    """Return the lowercased token set of text, dropping tokens shorter than 3 chars."""
    return frozenset(m.group(0).lower() for m in _TOKEN_RE.finditer(text) if len(m.group(0)) >= 3)


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


# ---------------------------------------------------------------------------
# Query analysis
# ---------------------------------------------------------------------------


def _extract_query_terms(query: str) -> frozenset[str]:
    """Pull content tokens out of a natural-language query.

    We intentionally keep *all* non-stopword tokens (not just capitalized
    ones) because the LLM agent often writes queries in lowercase. The
    minimum length filter drops trivial junk like "to", "if".
    """
    if not query:
        return frozenset()
    text = unicodedata.normalize("NFKC", query).lower()
    tokens = {
        m.group(0)
        for m in _TOKEN_RE.finditer(text)
        if len(m.group(0)) >= DEFAULT_CONFIG.min_query_token_length
        and m.group(0) not in _STOPWORDS
    }
    return frozenset(tokens)


# ---------------------------------------------------------------------------
# Filter pipeline
# ---------------------------------------------------------------------------


def _result_entities(result: Any) -> list[str]:
    """Extract the entities list from a recall result, whatever shape it has."""
    ents = getattr(result, "entities", None)
    if ents is None and isinstance(result, dict):
        ents = result.get("entities")
    if not ents:
        return []
    return [e for e in ents if isinstance(e, str) and e]


def _result_text(result: Any) -> str:
    text = getattr(result, "text", None)
    if text is None and isinstance(result, dict):
        text = result.get("text", "")
    return text or ""


def _result_type(result: Any) -> str:
    rtype = getattr(result, "type", None)
    if rtype is None and isinstance(result, dict):
        rtype = result.get("type", "")
    return rtype or ""


def _entity_matches_query(entities: Iterable[str], query_terms: frozenset[str]) -> bool:
    """True if any query term is a substring of any entity name (case-insensitive)."""
    for entity in entities:
        ename = entity.lower()
        for term in query_terms:
            if term in ename:
                return True
    return False


def _text_matches_query(text: str, query_terms: frozenset[str]) -> bool:
    """True if the result text contains any query term as a whole token."""
    tokens = _tokenize(text)
    return bool(tokens & query_terms)


def filter_recall_results(
    results: Sequence[Any],
    query: str,
    config: FilterConfig = DEFAULT_CONFIG,
) -> list[Any]:
    """Run the full post-recall filter pipeline.

    Returns the filtered list of recall result objects (same type as input),
    ready for the caller to format into agent-visible text.
    """
    if not results:
        return []

    # 1. Top-N pre-cap — recall ranking is already correct, truncate the tail.
    capped = list(results[: config.pre_cap])

    # 2. Entity-aware relevance filter.
    query_terms = _extract_query_terms(query)
    if not query_terms:
        # No meaningful tokens in the query (e.g., "what?"). Skip relevance
        # filtering — lexical dedup + hard cap will still tidy the output.
        logger.info("hindsight_recall_filter: no query terms extracted from %r; skipping relevance filter", query)
        relevance_filtered = capped
    else:
        kept: list[Any] = []
        for r in capped:
            rtype = _result_type(r)
            entities = _result_entities(r)
            if entities:
                # World-type rows have entities; require at least one match.
                if _entity_matches_query(entities, query_terms):
                    kept.append(r)
            else:
                # Observations have entities=None in 0.5.0. Fall back to text match.
                if _text_matches_query(_result_text(r), query_terms):
                    kept.append(r)
        if not kept:
            logger.info(
                "hindsight_recall_filter: entity filter dropped all %d results for query=%r; falling back to raw top-%d",
                len(capped), query, config.pre_cap,
            )
            relevance_filtered = capped
        else:
            relevance_filtered = kept

    # 3 & 4. Two-pass dedup:
    #
    #   Pass A: walk observations in recall order, deduping against each other.
    #           Observations are Hindsight's own consolidated summaries
    #           (each has a `source_memory_ids` list pointing at the world
    #           facts it merges), so they are higher-signal and belong at
    #           the top of the result set.
    #
    #   Pass B: walk world facts in recall order, dropping any that (a)
    #           near-duplicate an already-kept observation at the lower
    #           observation_beats_world threshold, or (b) near-duplicate
    #           an already-kept world fact at the full threshold.
    #
    # Without the two-pass split, a world fact that arrives BEFORE its
    # consolidating observation in recall order gets kept and the observation
    # is then dropped as a near-dup — the opposite of what we want. Marco's
    # "saved as favorite" cluster exhibits exactly this: items 7 (world), 8
    # (world), 9 (observation) in the raw recall.
    normalized: list[tuple[Any, str, frozenset[str], str]] = []
    for r in relevance_filtered:
        norm_text = _normalize_text(_result_text(r))
        tokens = _tokenize(norm_text)
        normalized.append((r, norm_text, tokens, _result_type(r)))

    # Preserve original recall order via position index for final sorting.
    indexed = list(enumerate(normalized))

    def _is_near_dup(
        tokens: frozenset[str],
        norm_text: str,
        rtype: str,
        kept: list[tuple[int, tuple[Any, str, frozenset[str], str]]],
    ) -> bool:
        for _, (k_r, k_norm, k_tokens, k_type) in kept:
            if norm_text == k_norm:
                return True
            # If we already kept an observation and the new one is a world
            # fact, use the more aggressive threshold.
            if k_type == "observation" and rtype == "world":
                if _jaccard(tokens, k_tokens) >= config.observation_beats_world_jaccard:
                    return True
                continue
            if _jaccard(tokens, k_tokens) >= config.dedup_jaccard_threshold:
                return True
        return False

    # Pass A: observations
    kept_obs: list[tuple[int, tuple[Any, str, frozenset[str], str]]] = []
    for pos, item in indexed:
        r, norm_text, tokens, rtype = item
        if rtype != "observation" or not norm_text:
            continue
        if not _is_near_dup(tokens, norm_text, rtype, kept_obs):
            kept_obs.append((pos, item))

    # Pass B: world facts, checked against both kept observations and kept worlds
    kept_all: list[tuple[int, tuple[Any, str, frozenset[str], str]]] = list(kept_obs)
    for pos, item in indexed:
        r, norm_text, tokens, rtype = item
        if rtype == "observation" or not norm_text:
            continue
        if not _is_near_dup(tokens, norm_text, rtype, kept_all):
            kept_all.append((pos, item))

    # Restore recall order (proof_count boost + semantic ranking) for the
    # agent-visible output.
    kept_all.sort(key=lambda p: p[0])
    deduped = [item[0] for _, item in kept_all]

    # 5. Hard cap.
    final = deduped[: config.final_cap]

    logger.info(
        "hindsight_recall_filter: query=%r  raw=%d  pre_cap=%d  relevance=%d  deduped=%d  final=%d",
        query, len(results), len(capped), len(relevance_filtered), len(deduped), len(final),
    )

    return final


def format_results_for_agent(results: Sequence[Any]) -> str:
    """Render filter output as the numbered list the tool returns to the LLM."""
    if not results:
        return "No relevant memories found."
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {_result_text(r)}")
    return "\n".join(lines)
