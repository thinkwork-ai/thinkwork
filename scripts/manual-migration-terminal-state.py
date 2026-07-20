#!/usr/bin/env python3
"""Resolve hand-rolled migration markers to their terminal schema state."""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

MARKER = re.compile(
    r"^--\s+(creates(?:-(?:column|extension|constraint|function|trigger|role|role-membership|policy))?|drops(?:-(?:column|constraint))?):\s+([A-Za-z0-9_.:]+)\s*$",
    re.MULTILINE,
)
MOVE_OWNER = re.compile(
    r"^--\s+moves-owner:\s+([A-Za-z0-9_.]+)\s+->\s+([A-Za-z0-9_.]+)\s*$",
    re.MULTILINE,
)
CREATE_INDEX = re.compile(
    r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    r"((?:\"?[A-Za-z0-9_]+\"?\.)?\"?[A-Za-z0-9_]+\"?)\s+ON\s+(?:ONLY\s+)?"
    r"((?:\"?[A-Za-z0-9_]+\"?\.)?\"?[A-Za-z0-9_]+\"?)",
    re.IGNORECASE,
)
DROP_TABLE = re.compile(
    r"DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_]+\.[A-Za-z0-9_]+)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Create:
    file: str
    order: int
    kind: str
    target: str
    owner: str | None


@dataclass(frozen=True)
class Drop:
    file: str
    order: int
    kind: str
    target: str
    drops_table: bool


@dataclass(frozen=True)
class Move:
    file: str
    order: int
    source: str
    destination: str


def indexed_files(journal: Path) -> set[str]:
    entries = json.loads(journal.read_text()).get("entries", [])
    return {f"{entry['tag']}.sql" for entry in entries}


def owner_table(kind: str, target: str, index_owners: dict[str, str]) -> str | None:
    if kind == "creates":
        owner = index_owners.get(target) or index_owners.get(target.rsplit(".", 1)[-1])
        if owner and "." not in owner:
            return f"{target.split('.', 1)[0]}.{owner}"
        return owner
    if kind in {"creates-column", "creates-constraint", "creates-trigger", "creates-policy"}:
        return ".".join(target.split(".")[:2])
    return None


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: manual-migration-terminal-state.py <drizzle-dir> <journal>", file=sys.stderr)
        return 2

    drizzle_dir = Path(sys.argv[1])
    journal = Path(sys.argv[2])
    indexed = indexed_files(journal)
    retirement_finalized = os.environ.get("AUTH_RETIREMENT_FINALIZED", "false") == "true"
    creates: list[Create] = []
    drops: list[Drop] = []
    moves: list[Move] = []

    migration_files = sorted(
        path
        for path in drizzle_dir.glob("*.sql")
        if path.name not in indexed and not path.name.endswith("_rollback.sql")
    )
    for order, path in enumerate(migration_files):
        sql = path.read_text()
        deferred = "-- deployment-phase: auth-retired" in sql and not retirement_finalized
        index_owners: dict[str, str] = {}
        for raw_index, raw_table in CREATE_INDEX.findall(sql):
            index = raw_index.replace('"', "")
            table = raw_table.replace('"', "")
            index_owners[index] = table
            if "." in index:
                index_owners[index.rsplit(".", 1)[-1]] = table
        dropped_tables = set(DROP_TABLE.findall(sql))
        if not deferred:
            moves.extend(Move(path.name, order, *match) for match in MOVE_OWNER.findall(sql))
        for match in MARKER.finditer(sql):
            kind, target = match.groups()
            if kind.startswith("creates"):
                creates.append(
                    Create(path.name, order, kind, target, owner_table(kind, target, index_owners))
                )
            elif not deferred:
                drops.append(Drop(path.name, order, kind, target, target in dropped_tables))

    for create in creates:
        resolution: tuple[int, int, str, str] | None = None
        for drop in drops:
            if drop.order <= create.order:
                continue
            exact_match = (
                (create.kind == "creates" and drop.kind == "drops" and create.target == drop.target)
                or (
                    create.kind == "creates-column"
                    and drop.kind == "drops-column"
                    and create.target == drop.target
                )
                or (
                    create.kind == "creates-constraint"
                    and drop.kind == "drops-constraint"
                    and create.target == drop.target
                )
            )
            owner_dropped = (
                create.owner is not None
                and drop.kind == "drops"
                and drop.drops_table
                and create.owner == drop.target
            )
            if exact_match or owner_dropped:
                candidate = (drop.order, 0, "-", drop.file)
                if resolution is None or candidate < resolution:
                    resolution = candidate
        for move in moves:
            if move.order <= create.order or create.owner != move.source:
                continue
            if create.kind == "creates":
                resolved_target = (
                    f"{move.destination.split('.', 1)[0]}.{create.target.rsplit('.', 1)[-1]}"
                )
            else:
                resolved_target = create.target.replace(move.source, move.destination, 1)
            candidate = (move.order, 1, resolved_target, move.file)
            if resolution is None or candidate < resolution:
                resolution = candidate
        if resolution:
            print(
                "\t".join((create.file, create.kind, create.target, resolution[2], resolution[3]))
            )

    for drop in drops:
        for create in creates:
            if create.order <= drop.order:
                continue
            recreated = (
                (drop.kind == "drops" and create.kind == "creates" and drop.target == create.target)
                or (
                    drop.kind == "drops-column"
                    and create.kind == "creates-column"
                    and drop.target == create.target
                )
                or (
                    drop.kind == "drops-constraint"
                    and create.kind == "creates-constraint"
                    and drop.target == create.target
                )
            )
            if recreated:
                print("\t".join((drop.file, drop.kind, drop.target, "-", create.file)))
                break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
