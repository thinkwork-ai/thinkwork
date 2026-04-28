from __future__ import annotations

import sys
from types import SimpleNamespace

from skill_runner import discover_workspace_skill_dirs, register_skill_tools


def test_discovers_skills_from_materialized_workspace(tmp_path):
    skill_dir = tmp_path / "skills" / "research"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: research\ndescription: Research carefully\n---\n\nUse sources.\n",
        encoding="utf-8",
    )
    nested = tmp_path / "support" / "skills" / "triage"
    nested.mkdir(parents=True)
    (nested / "SKILL.md").write_text(
        "---\nname: triage\n---\n\nTriage issues.\n",
        encoding="utf-8",
    )

    assert discover_workspace_skill_dirs(str(tmp_path)) == {
        "research": str(skill_dir),
        "triage": str(nested),
    }


def test_register_skill_tools_indexes_context_skills_without_payload_config(
    tmp_path, monkeypatch
):
    monkeypatch.setitem(
        sys.modules,
        "strands",
        SimpleNamespace(tool=lambda **_kw: lambda fn: fn),
    )
    skill_dir = tmp_path / "skills" / "research"
    skill_dir.mkdir(parents=True)
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(
        "---\nname: research\ndescription: Research carefully\n---\n\nUse sources.\n",
        encoding="utf-8",
    )

    tool_mode_tools, agent_mode_tools, meta = register_skill_tools(
        [],
        workspace_dir=str(tmp_path),
    )

    assert tool_mode_tools == []
    assert agent_mode_tools == {}
    assert meta["research"]["description"] == "Research carefully"
    assert meta["research"]["skill_dir"] == str(skill_dir)
    assert meta["research"]["skill_md_path"] == str(skill_md)
