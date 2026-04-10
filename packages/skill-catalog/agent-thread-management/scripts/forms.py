"""PRD-46: Question Card form rendering tool.

Provides `present_form` — a single Strands tool that reads a declarative
form schema (JSON) from a skill's references/ folder, merges any prefill
values supplied by the agent, and returns a `_type: question_card`
envelope that the app-manager frontend renders as a Question Card.

The user fills out the form in the UI and clicks Submit. The frontend then
sends a normal user message containing a ```form_response fenced block
with the submitted values, which the agent reads on its next turn.

This script is registered in agent-thread-management/skill.yaml so any
task-recipe skill can call it without bundling its own copy.
"""

import functools
import json
import os
import time

# Skills are synced to /app/skills/{skill_id}/ on the AgentCore VM by
# install_skills.py before the agent starts. present_form resolves form
# paths relative to this root.
SKILLS_DIR = os.environ.get("SKILLS_DIR", "/app/skills")

# Allowed field types for v1 (PRD-46). Adding a new type also requires a
# matching field component on the frontend in
# packages/app-manager/components/genui/fields/.
ALLOWED_FIELD_TYPES = {
    "text",
    "textarea",
    "boolean",
    "select",
    "user_picker",
    "date",
}


def _safe(fn):
    """Catch errors and return a JSON error envelope instead of raising."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            return json.dumps({"error": f"{type(exc).__name__}: {exc}"})
    return wrapper


def _resolve_form_path(form_path: str) -> str:
    """Resolve a form path to an absolute path under SKILLS_DIR.

    Accepts:
      - "customer-onboarding/references/intake-form.json" (skill-relative)
      - "/app/skills/customer-onboarding/references/intake-form.json" (absolute)
    """
    if os.path.isabs(form_path):
        resolved = form_path
    else:
        resolved = os.path.join(SKILLS_DIR, form_path)

    # Prevent path traversal — the resolved real path must stay under SKILLS_DIR.
    real = os.path.realpath(resolved)
    skills_real = os.path.realpath(SKILLS_DIR)
    if not real.startswith(skills_real + os.sep) and real != skills_real:
        raise ValueError(
            f"form_path {form_path!r} resolves outside SKILLS_DIR ({skills_real})"
        )
    return real


def _validate_schema(schema: dict, source_path: str) -> None:
    """Raise ValueError if the form schema is missing required structure."""
    if not isinstance(schema, dict):
        raise ValueError(f"{source_path}: form schema must be a JSON object")
    if not schema.get("id"):
        raise ValueError(f"{source_path}: form schema missing 'id'")
    fields = schema.get("fields")
    if not isinstance(fields, list) or not fields:
        raise ValueError(f"{source_path}: form schema must have non-empty 'fields' array")
    seen_ids: set[str] = set()
    for idx, field in enumerate(fields):
        if not isinstance(field, dict):
            raise ValueError(f"{source_path}: field[{idx}] is not an object")
        fid = field.get("id")
        if not fid or not isinstance(fid, str):
            raise ValueError(f"{source_path}: field[{idx}] missing string 'id'")
        if fid in seen_ids:
            raise ValueError(f"{source_path}: duplicate field id {fid!r}")
        seen_ids.add(fid)
        if not field.get("label"):
            raise ValueError(f"{source_path}: field {fid!r} missing 'label'")
        ftype = field.get("type")
        if ftype not in ALLOWED_FIELD_TYPES:
            raise ValueError(
                f"{source_path}: field {fid!r} has unsupported type {ftype!r}. "
                f"Allowed: {sorted(ALLOWED_FIELD_TYPES)}"
            )
        if ftype == "select":
            options = field.get("options")
            if not isinstance(options, list) or not options:
                raise ValueError(
                    f"{source_path}: select field {fid!r} requires non-empty 'options' array"
                )


def _coerce_prefill(prefill: dict, schema: dict) -> dict:
    """Drop any prefill keys that do not correspond to a field in the schema."""
    field_ids = {f["id"] for f in schema["fields"]}
    return {k: v for k, v in prefill.items() if k in field_ids}


@_safe
def present_form(form_path: str, prefill_json: str = "") -> str:
    """Render a Question Card form for the user to fill out and submit.

    Use this tool when a task recipe needs structured intake from the user.
    Instead of asking N questions one at a time, present the entire form at
    once with any values you can extract from the conversation already
    prefilled. The user fills the rest in and clicks Submit.

    The user's next message will contain a ```form_response fenced block
    with all the submitted values as JSON. Parse it and proceed.

    Args:
        form_path: Path to the form schema JSON file. Either skill-relative
            (e.g. 'customer-onboarding/references/intake-form.json') or
            absolute under /app/skills.
        prefill_json: Optional JSON string mapping field id -> prefilled
            value. Extract obvious values from the user's first message.
            Example: '{"name": "Beta, LLC", "fuel_customer": true}'.
            Pass an empty string when there is nothing to prefill.

    Returns:
        JSON envelope with `_type: "question_card"` that the frontend
        renders as a form. Returns `{"error": "..."}` on failure — the
        agent should fall back to conversational intake in that case.
    """
    if not form_path:
        raise ValueError("form_path is required")

    resolved = _resolve_form_path(form_path)
    if not os.path.isfile(resolved):
        raise FileNotFoundError(f"form schema not found at {resolved}")

    with open(resolved, encoding="utf-8") as f:
        schema = json.load(f)

    _validate_schema(schema, form_path)

    prefill: dict = {}
    if prefill_json:
        try:
            parsed = json.loads(prefill_json)
        except json.JSONDecodeError as exc:
            raise ValueError(f"prefill_json is not valid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("prefill_json must decode to a JSON object")
        prefill = _coerce_prefill(parsed, schema)

    envelope = {
        "_type": "question_card",
        "form_id": schema["id"],
        "schema": schema,
        "values": prefill,
        "_source": {"tool": "present_form", "params": {"form_path": form_path}},
        "_refreshedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return json.dumps(envelope)
