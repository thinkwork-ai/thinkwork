"""compound_reflect — extract and store learnings from a completed run.

Paired with `compound_recall`: reflect writes what recall reads. Edit
the two docstrings together (auto-memory
`feedback_hindsight_recall_reflect_pair`).

Best-effort. Bedrock down? Validation fails? AgentCore write rejected?
Log, skip, return a "skipped" summary. Compositions must never fail
because learnings couldn't be stored.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


MAX_LEARNINGS_PER_RUN = 3
MAX_LEARNING_CHARS = 2000

_EXTRACTION_PROMPT = """You are the `compound_reflect` step of a composition run.

Given the composition's inputs and the delivered artifact, identify up
to {max_learnings} NEW observations worth remembering for future runs.

Each observation must be:
- 1 to 2 sentences.
- Concrete and specific (name a customer, rep, or pattern).
- Non-obvious — something a first-time reader wouldn't already have
  guessed from reading the skill's documentation.
- Not already captured in prior learnings (if any are provided).

Return ONLY JSON in this exact shape, with no prose before or after:

{{"learnings": ["observation 1", "observation 2", ...]}}

If nothing is worth remembering, return:

{{"learnings": []}}

Composition inputs:
{run_inputs}

Delivered artifact:
{deliverable}

Prior learnings (for reference — don't duplicate):
{prior_learnings}
"""


# --- Indirection for tests --------------------------------------------------


def _bedrock_extract(prompt: str) -> str:
    """Single Bedrock Converse call — returns the assistant text.

    Isolated so tests can monkeypatch. Production wires this through the
    same bedrock-runtime client the rest of the container uses.
    """
    import boto3  # local import — tests patch this function wholesale

    region = os.environ.get("AWS_REGION", "us-east-1")
    model_id = os.environ.get(
        "COMPOUND_REFLECT_MODEL",
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    )
    client = boto3.client("bedrock-runtime", region_name=region)
    response = client.converse(
        modelId=model_id,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": 800, "temperature": 0.2},
    )
    return response["output"]["message"]["content"][0]["text"]


def _store_learning(scope: dict, content: str) -> bool:
    # Production: the agentcore container pre-adds its directory to
    # sys.path, so `memory` imports by bare name. Tests monkeypatch this
    # function so the real import never fires.
    from memory import store_learning  # noqa: PLC0415
    return store_learning(scope, content)


# --- Public tool -------------------------------------------------------------


def compound_reflect(
    tenant_id: str,
    skill_id: str,
    run_inputs: str,
    deliverable: str,
    user_id: str = "",
    subject_entity_id: str = "",
    prior_learnings: str = "",
) -> str:
    """Extract up to 3 non-obvious observations from this run and store them.

    Paired with `compound_recall` — recall reads what this step writes.
    Edit the two docstrings together.

    Write contract:
      - Up to 3 learnings per run, each 1-2 sentences, concrete and
        non-obvious.
      - Scoped to (tenant_id, user_id?, skill_id, subject_entity_id?).
      - Anything failing validation (non-JSON LLM output, empty, over
        ~2000 chars per entry) is silently dropped.
      - Store failures are logged and swallowed — compositions do not
        fail because a learning couldn't be persisted.

    Args:
        tenant_id: The tenant this run belongs to. Required.
        skill_id: The composition skill id. Required.
        run_inputs: JSON (or free-form) string of the composition's
            resolved inputs.
        deliverable: The composition's final output artifact. Passed to
            the LLM as context for extraction.
        user_id: Invoker user id. Empty = tenant-wide scope.
        subject_entity_id: Optional entity the run centers on.
        prior_learnings: Output of the paired compound_recall — helps
            the LLM avoid re-storing duplicates.

    Returns:
        A short status summary, e.g. `{"stored": 3}` or `"skipped: ..."`.
    """
    if not tenant_id or not skill_id:
        logger.info("compound_reflect skipped: missing tenant_id or skill_id")
        return "skipped: missing tenant_id or skill_id"

    prompt = _EXTRACTION_PROMPT.format(
        max_learnings=MAX_LEARNINGS_PER_RUN,
        run_inputs=run_inputs or "(none)",
        deliverable=deliverable or "(none)",
        prior_learnings=prior_learnings or "(none)",
    )

    try:
        raw = _bedrock_extract(prompt)
    except Exception as exc:
        logger.warning("compound_reflect bedrock call failed: %s", exc)
        return "skipped: extraction failed"

    learnings = _parse_learnings(raw)
    if not learnings:
        return "skipped: no learnings extracted"

    scope: dict = {"tenant_id": tenant_id, "skill_id": skill_id}
    if user_id:
        scope["user_id"] = user_id
    if subject_entity_id:
        scope["subject_entity_id"] = subject_entity_id

    stored = 0
    for content in learnings[:MAX_LEARNINGS_PER_RUN]:
        try:
            ok = _store_learning(scope, content)
        except Exception as exc:
            logger.warning("compound_reflect store exception: %s", exc)
            continue
        if ok:
            stored += 1

    return json.dumps({"stored": stored, "extracted": len(learnings)})


# --- Validation --------------------------------------------------------------


def _parse_learnings(raw: str) -> list[str]:
    """Validate LLM output and return the list of learnings to store.

    Returns [] on any validation failure. Drops individual entries that
    are empty or too long.
    """
    if not raw or not raw.strip():
        return []
    stripped = raw.strip()
    # Tolerate ```json fences the model sometimes adds.
    if stripped.startswith("```"):
        stripped = stripped.split("```", 2)[-1].strip()
        if stripped.endswith("```"):
            stripped = stripped[: -len("```")].strip()
        if stripped.startswith("json"):
            stripped = stripped[len("json"):].strip()

    try:
        parsed: Any = json.loads(stripped)
    except json.JSONDecodeError:
        logger.info("compound_reflect non-JSON LLM output (len=%d)", len(raw))
        return []

    if not isinstance(parsed, dict) or "learnings" not in parsed:
        logger.info("compound_reflect LLM output missing 'learnings' key")
        return []

    raw_list = parsed.get("learnings") or []
    if not isinstance(raw_list, list):
        return []

    valid: list[str] = []
    for entry in raw_list:
        if not isinstance(entry, str):
            continue
        text = entry.strip()
        if not text:
            continue
        if len(text) > MAX_LEARNING_CHARS:
            logger.info("compound_reflect dropping learning (len=%d > %d)",
                        len(text), MAX_LEARNING_CHARS)
            continue
        valid.append(text)
    return valid
