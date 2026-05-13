"""Local Thinkwork shadcn registry lookup for generated app guidance."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

try:
    from strands import tool
except Exception:  # pragma: no cover - local tests run without Strands installed.

    def tool(func):  # type: ignore[no-redef]
        return func


class ShadcnRegistryUnavailable(RuntimeError):
    """Raised when no usable generated-app component registry is available."""


_EMBEDDED_REGISTRY: dict[str, Any] = {
    "version": "generated-app-policy:v1",
    "components": [
        {
            "id": "button",
            "exportName": "Button",
            "importSpecifier": "@thinkwork/ui",
            "role": "command",
            "replaces": ["button", "cta", "toolbar-action"],
            "description": "Use for every clickable command or action.",
            "example": 'import { Button } from "@thinkwork/ui";',
        },
        {
            "id": "card",
            "exportName": "Card",
            "importSpecifier": "@thinkwork/ui",
            "role": "panel",
            "replaces": ["card", "metric-card", "bordered-panel"],
            "description": "Use for framed panels and metric groups.",
            "example": 'import { Card, CardContent } from "@thinkwork/ui";',
        },
        {
            "id": "badge",
            "exportName": "Badge",
            "importSpecifier": "@thinkwork/ui",
            "role": "status",
            "replaces": ["badge", "pill", "status-label", "tag"],
            "description": "Use for status labels, tags, and compact categorical markers.",
            "example": 'import { Badge } from "@thinkwork/ui";',
        },
        {
            "id": "tabs",
            "exportName": "Tabs",
            "importSpecifier": "@thinkwork/ui",
            "role": "tab-set",
            "replaces": ["tabs", "segmented-navigation"],
            "description": "Use Tabs, TabsList, TabsTrigger, and TabsContent.",
            "example": 'import { Tabs, TabsList, TabsTrigger } from "@thinkwork/ui";',
        },
        {
            "id": "table",
            "exportName": "Table",
            "importSpecifier": "@thinkwork/ui",
            "role": "table",
            "replaces": ["table", "thead", "tbody", "tr", "td", "th"],
            "description": "Use Table primitives for simple tabular data.",
            "example": 'import { Table, TableBody, TableRow } from "@thinkwork/ui";',
        },
        {
            "id": "data-table",
            "exportName": "DataTable",
            "importSpecifier": "@thinkwork/ui",
            "role": "data-grid",
            "replaces": ["sortable-table", "filterable-table", "operational-grid"],
            "description": "Use for dense sortable/scannable business records.",
            "example": 'import { DataTable } from "@thinkwork/ui";',
        },
        {
            "id": "select",
            "exportName": "Select",
            "importSpecifier": "@thinkwork/ui",
            "role": "select",
            "replaces": ["select", "dropdown", "single-select"],
            "description": "Use for dropdown value selection.",
            "example": 'import { Select, SelectTrigger } from "@thinkwork/ui";',
        },
        {
            "id": "dropdown-menu",
            "exportName": "DropdownMenu",
            "importSpecifier": "@thinkwork/ui",
            "role": "menu",
            "replaces": ["action-menu", "overflow-menu", "dropdown-actions"],
            "description": "Use for action menus and overflow command lists.",
            "example": 'import { DropdownMenu } from "@thinkwork/ui";',
        },
        {
            "id": "combobox",
            "exportName": "Combobox",
            "importSpecifier": "@thinkwork/ui",
            "role": "combobox",
            "replaces": ["searchable-select", "autocomplete", "typeahead"],
            "description": "Use when a dropdown must be searchable.",
            "example": 'import { Combobox } from "@thinkwork/ui";',
        },
        {
            "id": "chart-container",
            "exportName": "ChartContainer",
            "importSpecifier": "@thinkwork/ui",
            "role": "chart",
            "replaces": ["raw-recharts-wrapper", "chart-frame"],
            "description": "Required wrapper for Recharts primitives.",
            "example": 'import { ChartContainer } from "@thinkwork/ui";',
        },
        {
            "id": "host-map",
            "exportName": "MapView",
            "importSpecifier": "@thinkwork/computer-stdlib",
            "role": "map",
            "replaces": ["leaflet", "react-leaflet", "map-iframe"],
            "description": "The sole approved map surface for generated apps.",
            "example": 'import { MapView } from "@thinkwork/computer-stdlib";',
        },
    ],
}


def load_registry(path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    registry_path = _registry_path(path)
    if registry_path:
        try:
            with registry_path.open("r", encoding="utf-8") as handle:
                registry = json.load(handle)
            _validate_registry(registry)
            return registry
        except (OSError, json.JSONDecodeError, ShadcnRegistryUnavailable) as exc:
            if path or os.environ.get("THINKWORK_SHADCN_REGISTRY_PATH"):
                raise ShadcnRegistryUnavailable(str(exc)) from exc

    _validate_registry(_EMBEDDED_REGISTRY)
    return _EMBEDDED_REGISTRY


def list_components(path: str | os.PathLike[str] | None = None) -> list[dict[str, Any]]:
    return list(load_registry(path).get("components", []))


def search_registry(query: str, path: str | os.PathLike[str] | None = None) -> list[dict[str, Any]]:
    terms = [term for term in query.lower().split() if term]
    if not terms:
        return list_components(path)
    matches: list[dict[str, Any]] = []
    for component in list_components(path):
        haystack = " ".join(
            [
                str(component.get("id", "")),
                str(component.get("exportName", "")),
                str(component.get("role", "")),
                str(component.get("description", "")),
                " ".join(str(item) for item in component.get("replaces", [])),
            ],
        ).lower()
        if any(term in haystack for term in terms):
            matches.append(component)
    return matches


def get_component_source(
    name: str,
    path: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    component = _find_component(name, path)
    if not component:
        raise ShadcnRegistryUnavailable(f"Unknown Thinkwork generated-app component: {name}")
    return component


def get_block(name: str, path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    if name in {"generated-app-surface", "generated-app-components"}:
        registry = load_registry(path)
        return {
            "id": "generated-app-surface",
            "version": registry["version"],
            "digest": registry_digest(path),
            "components": list_components(path),
        }
    return get_component_source(name, path)


def compact_registry_context(path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    registry = load_registry(path)
    return {
        "version": registry["version"],
        "digest": registry_digest(path),
        "components": [
            {
                "id": item["id"],
                "exportName": item["exportName"],
                "importSpecifier": item["importSpecifier"],
                "role": item["role"],
                "replaces": item.get("replaces", []),
                "description": item.get("description", ""),
                "example": item.get("example", ""),
            }
            for item in registry["components"]
        ],
    }


def registry_digest(path: str | os.PathLike[str] | None = None) -> str:
    registry = load_registry(path)
    canonical = json.dumps(registry, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def make_shadcn_registry_tools(strands_tool=tool) -> list[Any]:
    """Expose shadcn-registry lookup as MCP-compatible Strands tools."""

    load_registry_fn = load_registry
    list_components_fn = globals()["list_components"]
    search_registry_fn = globals()["search_registry"]
    get_component_source_fn = globals()["get_component_source"]
    get_block_fn = globals()["get_block"]
    registry_digest_fn = registry_digest

    @strands_tool
    def list_components() -> dict[str, Any]:
        """List approved Thinkwork shadcn components for generated TSX apps."""

        registry = load_registry_fn()
        return {
            "version": registry["version"],
            "digest": registry_digest_fn(),
            "components": list_components_fn(),
        }

    @strands_tool
    def search_registry(query: str) -> dict[str, Any]:
        """Search approved Thinkwork shadcn components before emitting TSX."""

        registry = load_registry_fn()
        return {
            "version": registry["version"],
            "digest": registry_digest_fn(),
            "query": query,
            "components": search_registry_fn(query),
        }

    @strands_tool
    def get_component_source(name: str) -> dict[str, Any]:
        """Return source guidance for one approved Thinkwork shadcn component."""

        registry = load_registry_fn()
        return {
            "version": registry["version"],
            "digest": registry_digest_fn(),
            "component": get_component_source_fn(name),
        }

    @strands_tool
    def get_block(name: str) -> dict[str, Any]:
        """Return a generated-app shadcn block or component guidance bundle."""

        return get_block_fn(name)

    return [list_components, search_registry, get_component_source, get_block]


def _find_component(
    name: str,
    path: str | os.PathLike[str] | None = None,
) -> dict[str, Any] | None:
    needle = name.lower()
    for component in list_components(path):
        if needle in {
            str(component.get("id", "")).lower(),
            str(component.get("exportName", "")).lower(),
        }:
            return component
    return None


def _registry_path(path: str | os.PathLike[str] | None = None) -> Path | None:
    explicit = path or os.environ.get("THINKWORK_SHADCN_REGISTRY_PATH")
    if explicit:
        return Path(explicit)

    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "packages" / "ui" / "registry" / "generated-app-components.json"
        if candidate.exists():
            return candidate
    return None


def _validate_registry(registry: dict[str, Any]) -> None:
    if not isinstance(registry, dict):
        raise ShadcnRegistryUnavailable("Generated-app registry must be a JSON object.")
    if not registry.get("version"):
        raise ShadcnRegistryUnavailable("Generated-app registry is missing a version.")
    components = registry.get("components")
    if not isinstance(components, list) or not components:
        raise ShadcnRegistryUnavailable("Generated-app registry has no components.")
    for component in components:
        if not isinstance(component, dict):
            raise ShadcnRegistryUnavailable("Generated-app registry component must be an object.")
        for field in ("id", "exportName", "importSpecifier", "role", "description"):
            if not isinstance(component.get(field), str) or not component[field].strip():
                raise ShadcnRegistryUnavailable(
                    f"Generated-app registry component is missing {field}."
                )
