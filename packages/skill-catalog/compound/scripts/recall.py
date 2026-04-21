"""compound_recall — retrieve prior learnings for a composition run.

Paired with `compound_reflect`: recall reads what reflect wrote. Edit the
two docstrings together (auto-memory `feedback_hindsight_recall_reflect_pair`).

Best-effort. Any failure returns an empty string so the composition runs
with no prior context rather than aborting.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


# Indirection so tests can monkeypatch without importing memory.py at
# collection time (the production module pulls in boto3).
#
# Production: the agentcore container adds its own directory to sys.path
# at startup, making `memory` importable by bare name. Tests replace this
# symbol before calling compound_recall so the real import never fires.
def _recall_learnings(scope: dict, query: str, top_k: int = 5) -> list[dict]:
    from memory import recall_learnings  # noqa: PLC0415 — lazy in production
    return recall_learnings(scope, query, top_k=top_k)


def compound_recall(
    tenant_id: str,
    skill_id: str,
    query: str,
    user_id: str = "",
    subject_entity_id: str = "",
    top_k: int = 5,
) -> str:
    """Retrieve prior learnings for this composition run.

    REQUIRED FOLLOW-UP: at the end of the same composition, call
    `compound_reflect` with the run's inputs and deliverable so future
    runs learn from this one. Calling recall without reflect means the
    learnings pool never grows — the whole compound loop is the feature.

    Scope: (tenant_id, user_id?, skill_id, subject_entity_id?)

    Returns a plain string (one learning per line, separated by `---`).
    Empty string means no prior learnings matched — the composition
    should treat that as benign.

    Args:
        tenant_id: The tenant this run belongs to. Required.
        skill_id: The composition skill id (e.g. "sales-prep"). Required.
        query: Free-form text to search by. Usually the composition's
            framed problem or a concatenation of the user-provided inputs.
        user_id: The invoker's user id. Empty = tenant-wide scope only.
        subject_entity_id: An entity the run centers on (e.g. a customer
            id). Empty = not subject-scoped.
        top_k: Cap on results across all scope tiers. Default 5.

    Returns:
        A string of learnings, highest-priority tier first, one per line.
        Empty string if no matches or on error.
    """
    if not tenant_id or not skill_id:
        logger.info("compound_recall skipped: missing tenant_id or skill_id")
        return ""

    scope: dict = {"tenant_id": tenant_id, "skill_id": skill_id}
    if user_id:
        scope["user_id"] = user_id
    if subject_entity_id:
        scope["subject_entity_id"] = subject_entity_id

    try:
        learnings = _recall_learnings(scope, query, top_k=top_k)
    except Exception as exc:
        logger.warning("compound_recall failed scope=%s: %s", scope, exc)
        return ""

    if not learnings:
        return ""

    lines = [entry.get("text", "") for entry in learnings if entry.get("text")]
    return "\n---\n".join(lines)
