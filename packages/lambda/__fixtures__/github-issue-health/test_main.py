"""Deterministic-digest tests for the THINK-280 U7 issue-health tracer.

These exercise the pure `compute_digest` core against the frozen fixtures — no
broker, no network. `run()` (the broker-driven entrypoint) is covered by the
TypeScript executor tests, which serve the same operations through the fixture
adapter registry so they make zero live calls.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_HERE = Path(__file__).parent
_spec = importlib.util.spec_from_file_location("tracer_main", _HERE / "main.py")
assert _spec and _spec.loader
main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(main)

with (_HERE / "issues.json").open() as fh:
    FIXTURES = json.load(fh)

REPO = FIXTURES["repo"]
AS_OF = FIXTURES["as_of"]


def _all_page_issues() -> list[dict]:
    issues: list[dict] = []
    for page in FIXTURES["pages"]:
        issues.extend(page)
    return issues


def test_digest_excludes_closed_and_pull_requests() -> None:
    digest = main.compute_digest(_all_page_issues(), REPO, AS_OF)
    # 101, 102, 103 are open issues; 104 is closed; 105 is a PR.
    assert digest["totals"]["open"] == 3
    assert digest["source"] == {"repo": REPO, "as_of": AS_OF}


def test_digest_stale_and_unowned_counts() -> None:
    digest = main.compute_digest(_all_page_issues(), REPO, AS_OF)
    # 102 (May) and 103 (Jan) are >30d stale as of 2026-07-13; 101 (Jul 10) is not.
    assert digest["totals"]["stale"] == 2
    assert digest["stale_issues"] == [102, 103]
    # 102 and 103 have no assignees.
    assert digest["totals"]["unowned"] == 2
    assert digest["by_assignee"]["__unassigned__"] == 2
    assert digest["by_assignee"]["bob"] == 1


def test_digest_groups_by_label_including_unlabeled() -> None:
    digest = main.compute_digest(_all_page_issues(), REPO, AS_OF)
    assert digest["by_label"]["bug"] == 1  # only open 101 (104 closed excluded)
    assert digest["by_label"]["auth"] == 1
    assert digest["by_label"]["docs"] == 1
    assert digest["by_label"]["__unlabeled__"] == 1  # issue 103


def test_digest_is_deterministic_and_key_sorted() -> None:
    issues = _all_page_issues()
    first = main.compute_digest(issues, REPO, AS_OF)
    second = main.compute_digest(list(reversed(issues)), REPO, AS_OF)
    # Order-independent: reversing input yields an identical digest.
    assert first == second
    assert list(first["by_label"].keys()) == sorted(first["by_label"].keys())
    assert list(first["by_assignee"].keys()) == sorted(first["by_assignee"].keys())


def test_zero_open_issues() -> None:
    digest = main.compute_digest(
        FIXTURES["edge_cases"]["zero_open_issues"], REPO, AS_OF
    )
    assert digest["totals"] == {"open": 0, "stale": 0, "unowned": 0}
    assert digest["by_label"] == {}
    assert digest["stale_issues"] == []


def test_duplicate_pages_collapse_by_number() -> None:
    pages = FIXTURES["edge_cases"]["duplicate_pages"]
    flat = [issue for page in pages for issue in page]
    digest = main.compute_digest(flat, REPO, AS_OF)
    # Issue 201 appears on two pages but counts once.
    assert digest["totals"]["open"] == 1
    assert digest["by_label"]["bug"] == 1


def test_missing_fields_do_not_crash() -> None:
    digest = main.compute_digest(
        FIXTURES["edge_cases"]["missing_fields"], REPO, AS_OF
    )
    assert digest["totals"]["open"] == 1
    # Missing created_at → unknown age bucket, not stale.
    assert digest["by_age"]["unknown"] == 1
    assert digest["totals"]["stale"] == 0
    # Missing labels/assignees → unlabeled + unassigned.
    assert digest["by_label"]["__unlabeled__"] == 1
    assert digest["totals"]["unowned"] == 1


def test_render_report_is_stable() -> None:
    digest = main.compute_digest(_all_page_issues(), REPO, AS_OF)
    report = main.render_report(digest)
    assert report == main.render_report(digest)
    assert f"# Issue health — {REPO}" in report
    assert "Open issues: **3**" in report
