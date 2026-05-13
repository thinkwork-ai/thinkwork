import json
from pathlib import Path

import pytest
import shadcn_registry

REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / "ui" / "registry" / "generated-app-components.json"
)


def test_loads_repo_registry_with_component_roles():
    registry = shadcn_registry.load_registry(REGISTRY_PATH)

    ids = {component["id"] for component in registry["components"]}
    assert {"button", "card", "tabs", "table", "badge", "data-table"} <= ids
    for component in registry["components"]:
        assert component["approvedForGeneratedApps"] is True
        assert component["role"]
        assert component["replaces"]
        assert component["example"]


def test_search_registry_finds_dropdown_options():
    results = shadcn_registry.search_registry("dropdown", REGISTRY_PATH)
    exports = {result["exportName"] for result in results}

    assert {"Select", "DropdownMenu", "Combobox"} <= exports


def test_compact_registry_context_includes_digest_and_examples():
    context = shadcn_registry.compact_registry_context(REGISTRY_PATH)

    assert context["version"] == "generated-app-policy:v1"
    assert context["digest"].startswith("sha256:")
    button = next(item for item in context["components"] if item["id"] == "button")
    assert button["importSpecifier"] == "@thinkwork/ui"
    assert "Button" in button["example"]


def test_registry_tools_expose_mcp_compatible_names(monkeypatch):
    monkeypatch.setenv("THINKWORK_SHADCN_REGISTRY_PATH", str(REGISTRY_PATH))

    tools = shadcn_registry.make_shadcn_registry_tools(lambda func: func)
    by_name = {tool.__name__: tool for tool in tools}

    assert {"list_components", "search_registry", "get_component_source", "get_block"} <= set(
        by_name
    )
    listed = by_name["list_components"]()
    assert listed["version"] == "generated-app-policy:v1"
    assert listed["digest"].startswith("sha256:")
    assert any(component["id"] == "button" for component in listed["components"])
    searched = by_name["search_registry"]("dropdown")
    assert any(component["exportName"] == "Combobox" for component in searched["components"])
    source = by_name["get_component_source"]("Card")
    assert source["component"]["id"] == "card"
    block = by_name["get_block"]("generated-app-surface")
    assert block["id"] == "generated-app-surface"


def test_missing_explicit_registry_fails_closed(tmp_path):
    missing = tmp_path / "missing.json"

    with pytest.raises(shadcn_registry.ShadcnRegistryUnavailable):
        shadcn_registry.load_registry(missing)


def test_unparsable_registry_fails_closed(tmp_path):
    bad = tmp_path / "generated-app-components.json"
    bad.write_text(json.dumps({"version": "x", "components": []}), encoding="utf-8")

    with pytest.raises(shadcn_registry.ShadcnRegistryUnavailable):
        shadcn_registry.load_registry(bad)
