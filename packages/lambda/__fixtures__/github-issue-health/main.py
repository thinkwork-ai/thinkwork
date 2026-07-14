"""GitHub issue-health digest — the THINK-280 U7 tracer routine.

This is the exact validated module a governed capability-headless Automation
runs in a capability-private Code Interpreter session. It performs ZERO agent
turns: it deterministically fetches the configured repository's open issues
through the broker (the ONLY declared read operations), groups them by age,
label, and assignee, reports stale + unowned counts with source repo / as-of
metadata, and writes a single report Artifact through the platform Artifact
operation.

The digest core (`compute_digest`) is a pure function so its determinism and
edge cases (zero issues, missing labels/assignees, duplicate pages, unchanged
input) are testable without a broker. `run(input)` is the sandbox entrypoint:
it paginates `issues.list` through the broker, computes the digest, writes the
Artifact, and returns the structured evidence the trusted executor records.

Every broker call is signed with the short-lived session bootstrap the trusted
host injected as the reserved global `_twcap_session`. No provider credential
is ever present in this sandbox — the broker holds those.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

# Bounded pagination — matches issues.list contract (per_page=50, page<=20).
MAX_PAGES = 20
PER_PAGE = 50

# Age buckets in days (open-issue age measured from created_at to as_of).
STALE_AFTER_DAYS = 30
UNASSIGNED_KEY = "__unassigned__"
UNLABELED_KEY = "__unlabeled__"


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        # GitHub timestamps are RFC 3339 "Z"; normalize to offset-aware UTC.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _age_days(created_at: Any, as_of: datetime) -> int | None:
    created = _parse_ts(created_at)
    if created is None:
        return None
    return max(0, (as_of - created).days)


def _age_bucket(days: int | None) -> str:
    if days is None:
        return "unknown"
    if days < 7:
        return "lt_7d"
    if days < 30:
        return "d7_30"
    if days < 90:
        return "d30_90"
    return "gt_90d"


def _dedupe_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Duplicate issue pages are collapsed by issue number — a re-served page
    (retry / overlapping pagination) must never double-count."""
    seen: dict[int, dict[str, Any]] = {}
    for issue in issues:
        number = issue.get("number")
        if isinstance(number, int) and number not in seen:
            seen[number] = issue
    return [seen[num] for num in sorted(seen)]


def compute_digest(
    issues: list[dict[str, Any]],
    repo: str,
    as_of: str,
) -> dict[str, Any]:
    """Deterministic issue-health digest. Pure: identical inputs → identical
    output (stable key ordering, deduped issues, no wall-clock reads)."""
    as_of_dt = _parse_ts(as_of) or datetime.now(UTC)

    # Only OPEN issues, deduped. GitHub's issues endpoint also returns pull
    # requests; the digest excludes anything carrying a pull_request marker.
    open_issues = _dedupe_issues(
        [
            i
            for i in issues
            if i.get("state") == "open" and "pull_request" not in i
        ]
    )

    by_age: dict[str, int] = {
        "lt_7d": 0,
        "d7_30": 0,
        "d30_90": 0,
        "gt_90d": 0,
        "unknown": 0,
    }
    by_label: dict[str, int] = {}
    by_assignee: dict[str, int] = {}
    stale_numbers: list[int] = []
    unowned = 0

    for issue in open_issues:
        days = _age_days(issue.get("created_at"), as_of_dt)
        by_age[_age_bucket(days)] += 1

        if days is not None and days >= STALE_AFTER_DAYS:
            number = issue.get("number")
            if isinstance(number, int):
                stale_numbers.append(number)

        labels = issue.get("labels") or []
        label_names = [
            lbl.get("name")
            for lbl in labels
            if isinstance(lbl, dict) and isinstance(lbl.get("name"), str)
        ]
        if not label_names:
            by_label[UNLABELED_KEY] = by_label.get(UNLABELED_KEY, 0) + 1
        for name in label_names:
            by_label[name] = by_label.get(name, 0) + 1

        assignees = issue.get("assignees") or []
        logins = [
            a.get("login")
            for a in assignees
            if isinstance(a, dict) and isinstance(a.get("login"), str)
        ]
        if not logins:
            unowned += 1
            by_assignee[UNASSIGNED_KEY] = by_assignee.get(UNASSIGNED_KEY, 0) + 1
        for login in logins:
            by_assignee[login] = by_assignee.get(login, 0) + 1

    return {
        "source": {"repo": repo, "as_of": as_of},
        "totals": {
            "open": len(open_issues),
            "stale": len(stale_numbers),
            "unowned": unowned,
        },
        "by_age": by_age,
        "by_label": {k: by_label[k] for k in sorted(by_label)},
        "by_assignee": {k: by_assignee[k] for k in sorted(by_assignee)},
        "stale_issues": sorted(stale_numbers),
    }


def render_report(digest: dict[str, Any]) -> str:
    """Deterministic markdown body for the report Artifact."""
    src = digest["source"]
    totals = digest["totals"]
    lines = [
        f"# Issue health — {src['repo']}",
        "",
        f"_As of {src['as_of']}_",
        "",
        f"- Open issues: **{totals['open']}**",
        f"- Stale (>{STALE_AFTER_DAYS}d): **{totals['stale']}**",
        f"- Unowned: **{totals['unowned']}**",
        "",
        "## By age",
    ]
    for bucket, count in digest["by_age"].items():
        lines.append(f"- {bucket}: {count}")
    lines.append("")
    lines.append("## By label")
    for label, count in digest["by_label"].items():
        lines.append(f"- {label}: {count}")
    lines.append("")
    lines.append("## By assignee")
    for login, count in digest["by_assignee"].items():
        lines.append(f"- {login}: {count}")
    return "\n".join(lines)


def _broker_call(operation: str, payload: dict[str, Any]) -> Any:
    """Sign + issue one broker call using the injected session bootstrap.

    Present only in the capability-private sandbox (the trusted host injects
    `_twcap_session`). Kept import-light and lazy so the digest core imports
    without a broker. The concrete proof-of-possession transport is provided by
    the in-sandbox thinkwork broker client (U8 wiring); this shim raises when
    invoked outside a session so a mis-wired run fails loudly rather than
    silently reaching a provider."""
    session = globals().get("_twcap_session")
    if not session:
        raise RuntimeError("no capability session bootstrap present")
    client = globals().get("_twcap_client")
    if client is None:  # pragma: no cover - provided by the sandbox runtime
        from thinkwork_broker import BrokerClient  # type: ignore

        client = BrokerClient(session)
        globals()["_twcap_client"] = client
    return client.call(operation, payload)


def run(input: dict[str, Any]) -> dict[str, Any]:
    """Sandbox entrypoint. Returns structured evidence the executor records."""
    repo = str(input.get("repo") or input.get("_repo") or "")
    as_of = str(input.get("_asOf") or datetime.now(UTC).isoformat())
    broker_calls: list[dict[str, Any]] = []

    # Paginate issues.list (bounded). A short page (< PER_PAGE) ends pagination.
    issues: list[dict[str, Any]] = []
    for page in range(1, MAX_PAGES + 1):
        result = _broker_call(
            "issues.list", {"state": "open", "page": page}
        )
        broker_calls.append(
            {"operationRef": "issues.list", "effect": "read", "status": "completed"}
        )
        batch = result if isinstance(result, list) else []
        issues.extend(batch)
        if len(batch) < PER_PAGE:
            break

    digest = compute_digest(issues, repo, as_of)
    report = render_report(digest)

    artifact = _broker_call(
        "artifact.create",
        {
            "title": f"Issue health — {repo} — {as_of[:10]}",
            "type": "document",
            "summary": (
                f"{digest['totals']['open']} open, "
                f"{digest['totals']['stale']} stale, "
                f"{digest['totals']['unowned']} unowned"
            ),
            "content": report,
        },
    )
    artifact_id = artifact.get("ref") if isinstance(artifact, dict) else None
    broker_calls.append(
        {
            "operationRef": "artifact.create",
            "effect": "write",
            "status": "completed",
            "durableRef": {"kind": "artifact", "ref": artifact_id},
        }
    )

    return {
        "ok": True,
        "digest": digest,
        "artifactId": artifact_id,
        "brokerCalls": broker_calls,
    }


if __name__ == "__main__":  # pragma: no cover
    print(json.dumps(run({"repo": "example/repo"})))
