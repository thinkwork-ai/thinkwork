"""Render a synthesis dict into a Markdown deliverable using a named template.

Deterministic — no LLM call. Template substitution uses a minimal
mustache-style grammar: `{{ key }}` and `{{ nested.key }}`. Anything else
passes through literally.

Run standalone for debugging:

    python render.py sales_brief '{"synthesis": "## Risks\n..."}'
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

SUPPORTED_FORMATS = ("sales_brief", "health_report", "renewal_risk")

_TEMPLATE_TOKEN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}")


class UnknownFormatError(ValueError):
    """Raised when `format` is not one of the supported template names."""


class MissingTemplateError(FileNotFoundError):
    """Raised when the on-disk template file is missing for a supported format."""


def render_package(
    synthesis: str,
    format: str,
    metadata: dict[str, Any] | str | None = None,
) -> str:
    """Render a synthesis into a Markdown deliverable using a named template.

    Args:
        synthesis: Output of the synthesize step. Expected to contain the
            four-section structure (`## Risks`, `## Opportunities`,
            `## Open questions`, `## Talking points`), but this renderer
            does not enforce it — templates embed `synthesis` verbatim.
        format: One of `sales_brief`, `health_report`, `renewal_risk`.
            Validated at the input boundary; unknown formats raise
            UnknownFormatError.
        metadata: Optional dict (or JSON-encoded string) the template may
            interpolate via `{{ metadata.key }}`. Missing keys render as
            an empty string.

    Returns:
        The rendered Markdown deliverable as a single string.

    Raises:
        UnknownFormatError: if `format` is not supported.
        MissingTemplateError: if the template file is absent on disk.
        TypeError: if `synthesis` is not a string.
    """
    if format not in SUPPORTED_FORMATS:
        raise UnknownFormatError(
            f"Unknown format {format!r}. Supported: {', '.join(SUPPORTED_FORMATS)}."
        )
    if not isinstance(synthesis, str):
        raise TypeError(f"synthesis must be a string, got {type(synthesis).__name__}")

    metadata_dict = _coerce_metadata(metadata)
    template_text = _load_template(format)
    context = {"synthesis": synthesis, "metadata": metadata_dict}
    return _substitute(template_text, context)


def _coerce_metadata(metadata: dict[str, Any] | str | None) -> dict[str, Any]:
    if metadata is None:
        return {}
    if isinstance(metadata, dict):
        return metadata
    if isinstance(metadata, str):
        stripped = metadata.strip()
        if not stripped:
            return {}
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            # Tolerate a free-form string — templates that want it can read
            # `metadata.raw`; everything else sees empty keys.
            return {"raw": stripped}
        if isinstance(parsed, dict):
            return parsed
        return {"raw": parsed}
    raise TypeError(
        f"metadata must be dict, str, or None, got {type(metadata).__name__}"
    )


def _load_template(format: str) -> str:
    template_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "templates",
        f"{format}.md.tmpl",
    )
    if not os.path.isfile(template_path):
        raise MissingTemplateError(
            f"Template file not found for format {format!r}: {template_path}"
        )
    with open(template_path, encoding="utf-8") as fh:
        return fh.read()


def _substitute(template: str, context: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        path = match.group(1)
        return _lookup(context, path)

    return _TEMPLATE_TOKEN.sub(replace, template)


def _lookup(context: dict[str, Any], path: str) -> str:
    parts = path.split(".")
    cur: Any = context
    for part in parts:
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return ""
    if cur is None:
        return ""
    if isinstance(cur, str):
        return cur
    return json.dumps(cur) if not isinstance(cur, (int, float, bool)) else str(cur)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "usage: render.py <format> '<synthesis>' ['<metadata_json>']",
            file=sys.stderr,
        )
        sys.exit(2)
    fmt = sys.argv[1]
    synth = sys.argv[2]
    meta_arg = sys.argv[3] if len(sys.argv) > 3 else None
    print(render_package(synth, fmt, meta_arg))
