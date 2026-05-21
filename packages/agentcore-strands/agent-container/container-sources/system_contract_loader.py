"""System contract loader for the Strands runtime.

Loads behavioral-contract skills from ``packages/skill-catalog`` and
returns the rendered bodies whose ``activates_on`` frontmatter matches
the current turn's conditions. Sibling to ``skill_resolver`` — that
module is slug-pull (caller asks for ``slug=X``); this one is
condition-push (loader returns every match).

A "system contract" is a SKILL.md with frontmatter::

    ---
    name: computer-thread-contract
    description: ...
    contract: system               # discriminator vs. user-invocable skills
    activates_on:                  # every key-value pair must match `conditions`
      thread_mode: computer
    template_variables:            # optional; runtime substitutes {{var}} in body
      - thread_id
      - prompt
    ---
    body text with {{thread_id}} and {{prompt}} substitution points

The loader is pure — no S3, no HTTP, no filesystem walks outside
``catalog_dir``. The catalog directory ships in the container image so
boot-time IO is local-disk only.

Origin: docs/plans/2026-05-21-004-refactor-strands-system-contracts-as-skills-plan.md §U1.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from typing import Any

from skill_md_parser import (
    ParsedSkillMd,
    SkillMdParseError,
    parse_skill_md_string,
)

logger = logging.getLogger(__name__)


SYSTEM_CONTRACT_FIELD: str = "contract"
SYSTEM_CONTRACT_VALUE: str = "system"
ACTIVATES_ON_FIELD: str = "activates_on"
TEMPLATE_VARIABLES_FIELD: str = "template_variables"


def load_system_contracts(
    catalog_dir: str,
    conditions: Mapping[str, Any],
    variables: Mapping[str, str] | None = None,
) -> list[str]:
    """Return rendered bodies of every system contract whose conditions match.

    Walks ``<catalog_dir>/*/SKILL.md``, keeps only entries whose
    frontmatter declares ``contract: system``, filters by ``activates_on``
    (every key-value pair in the frontmatter dict must equal the
    corresponding entry in ``conditions``), and substitutes ``{{var}}``
    placeholders in the body for each variable listed in
    ``template_variables`` using ``variables``.

    Returns bodies sorted by skill slug so output ordering is
    deterministic across container restarts.

    A malformed SKILL.md logs a warning and is skipped — a typo in one
    contract should not abort the turn or take down all the others.

    A missing key in ``conditions`` is treated as a non-match: a
    frontmatter ``activates_on: { thread_mode: computer }`` requires
    ``conditions`` to contain ``"thread_mode": "computer"``. Absent
    keys fail closed — a typo in the frontmatter should not silently
    activate everywhere.
    """
    if not os.path.isdir(catalog_dir):
        logger.warning(
            "[system_contract_loader] catalog_dir %s does not exist; loading no contracts",
            catalog_dir,
        )
        return []

    vars_dict: dict[str, str] = dict(variables or {})
    matches: list[tuple[str, str]] = []  # (slug, rendered_body)

    for slug in sorted(os.listdir(catalog_dir)):
        skill_md_path = os.path.join(catalog_dir, slug, "SKILL.md")
        if not os.path.isfile(skill_md_path):
            continue

        try:
            with open(skill_md_path) as fh:
                source = fh.read()
        except OSError as exc:
            logger.warning(
                "[system_contract_loader] failed to read %s (%s); skipping",
                skill_md_path,
                exc,
            )
            continue

        try:
            parsed = parse_skill_md_string(source, skill_md_path)
        except SkillMdParseError as exc:
            logger.warning(
                "[system_contract_loader] %s has malformed frontmatter (%s); skipping",
                skill_md_path,
                exc,
            )
            continue

        if not _is_system_contract(parsed):
            continue

        if not _activates_on_matches(parsed, conditions):
            continue

        rendered = _render_body(parsed, vars_dict)
        matches.append((slug, rendered))

    matches.sort(key=lambda item: item[0])
    return [body for _slug, body in matches]


def _is_system_contract(parsed: ParsedSkillMd) -> bool:
    """Return True when the SKILL.md declares ``contract: system``."""
    if not parsed.frontmatter_present or not parsed.data:
        return False
    return parsed.data.get(SYSTEM_CONTRACT_FIELD) == SYSTEM_CONTRACT_VALUE


def _activates_on_matches(
    parsed: ParsedSkillMd, conditions: Mapping[str, Any]
) -> bool:
    """Return True when every ``activates_on`` key-value matches ``conditions``.

    A frontmatter without ``activates_on:`` is treated as always-on for
    system contracts that pass the ``contract: system`` discriminator —
    operators can declare a no-arg always-active contract by simply
    omitting the field. A non-dict ``activates_on`` (typo) logs a
    warning and fails closed.
    """
    activates_on = parsed.data.get(ACTIVATES_ON_FIELD)
    if activates_on is None:
        return True
    if not isinstance(activates_on, Mapping):
        logger.warning(
            "[system_contract_loader] %s has non-mapping activates_on (%s); skipping",
            parsed.source_path,
            type(activates_on).__name__,
        )
        return False
    for key, expected in activates_on.items():
        if key not in conditions:
            return False
        if conditions[key] != expected:
            return False
    return True


def _render_body(parsed: ParsedSkillMd, variables: Mapping[str, str]) -> str:
    """Substitute ``{{var}}`` placeholders for each declared template variable.

    A variable declared in ``template_variables`` but absent from
    ``variables`` substitutes to the empty string — matches the runtime
    pattern where an optional per-turn field (e.g. ``prompt``) may not
    be present on every invocation. Substitution is naive string
    replacement; there is no expression evaluation or conditional
    section support.

    Variables not declared in ``template_variables`` are not substituted
    even if they appear in ``variables`` — the frontmatter list is the
    authoritative declaration of what the contract expects.
    """
    declared = parsed.data.get(TEMPLATE_VARIABLES_FIELD)
    if not isinstance(declared, list) or not declared:
        return parsed.body

    body = parsed.body
    for name in declared:
        if not isinstance(name, str):
            logger.warning(
                "[system_contract_loader] %s has non-string template_variables entry "
                "(%s); skipping that entry",
                parsed.source_path,
                type(name).__name__,
            )
            continue
        placeholder = "{{" + name + "}}"
        body = body.replace(placeholder, str(variables.get(name, "")))
    return body
