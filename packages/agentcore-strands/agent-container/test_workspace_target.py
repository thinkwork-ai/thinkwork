from __future__ import annotations

from workspace_target import parse_target


ROUTES = ["expenses", "support/escalation", "a/b/c/d"]


def test_root_target_is_valid():
    result = parse_target(".", [])
    assert result.valid is True
    assert result.normalized_path == ""
    assert result.depth == 0
    assert result.reason is None


def test_routable_targets_are_valid():
    assert parse_target("expenses", ROUTES).valid is True
    assert parse_target("expenses", ROUTES).normalized_path == "expenses"
    assert parse_target("support/escalation", ROUTES).depth == 2


def test_path_safety_rejections():
    assert parse_target("../etc", ROUTES).reason == "traversal"
    assert parse_target("/expenses", ROUTES).reason == "absolute"
    assert parse_target("Expenses", ROUTES).reason == "malformed"
    assert parse_target("expenses//audit", ROUTES).reason == "malformed"


def test_reserved_names_are_rejected_at_any_depth():
    assert parse_target("memory", ["memory"]).reason == "reserved_name"
    assert parse_target("team/skills", ["team/skills"]).reason == "reserved_name"


def test_depth_cap_and_routing_rejections():
    too_deep = parse_target("a/b/c/d/e", ["a/b/c/d/e"])
    assert too_deep.depth == 5
    assert too_deep.reason == "depth_exceeded"
    assert parse_target("legal", ROUTES).reason == "not_routable"
