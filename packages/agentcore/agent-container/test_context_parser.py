"""Tests for context_parser.py — workspace CONTEXT.md parsing and discovery."""
import os
import tempfile
import pytest
from context_parser import parse_context_md, discover_workspaces, WorkspaceConfig


SAMPLE_CONTEXT = """# Personal Assistant

## What This Workspace Is
Handle personal requests — scheduling, restaurants, calendar management.

## Config
- model: us.anthropic.claude-haiku-4-5

## What to Load
| Task | Load These | Skip These |
|------|-----------|------------|
| Schedule meeting | docs/calendar-guide.md | docs/restaurant-tips.md |
| Find restaurant | docs/restaurant-tips.md | docs/calendar-guide.md |

## Skills & Tools
| Skill | When | Model Override | Purpose |
|-------|------|---------------|---------|
| Google Calendar | Scheduling tasks | — | Create/check events |
| Restaurant Search | Availability checks | — | Search Resy, OpenTable |
| Web Search | Research phase | — | Look up venues, hours |

## Process
1. Understand what the user needs
2. Use the appropriate tool
3. Confirm the result with the user

## What NOT to Do
- Don't look up CRM data (that's crm-specialist's job)
- Don't send emails without explicit user confirmation
"""

SIMPLE_CONTEXT = """# Research

## What This Workspace Is
Web research and fact-checking.

## Skills & Tools
| Skill | When | Purpose |
|-------|------|---------|
| Web Search | Always | Research topics |
"""

NO_SKILLS_CONTEXT = """# Documentation

## What This Workspace Is
Reference documentation for the team.

## What to Load
| Task | Load These |
|------|-----------|
| Read docs | docs/ |
"""


class TestParseContextMd:
    def test_full_parse(self, tmp_path):
        ctx_file = tmp_path / "CONTEXT.md"
        ctx_file.write_text(SAMPLE_CONTEXT)

        config = parse_context_md(str(ctx_file), slug="personal-assistant")

        assert config is not None
        assert config.name == "Personal Assistant"
        assert config.slug == "personal-assistant"
        assert "scheduling" in config.role.lower() or "personal" in config.role.lower()
        assert config.model == "us.anthropic.claude-haiku-4-5"
        assert len(config.skills) == 3
        assert config.skills[0].name == "Google Calendar"
        assert config.skills[0].when == "Scheduling tasks"
        assert config.skills[0].model_override == ""  # "—" normalizes to ""
        assert config.skills[1].name == "Restaurant Search"
        assert len(config.load_rules) == 2
        assert config.load_rules[0].task == "Schedule meeting"
        assert "calendar-guide.md" in config.load_rules[0].load[0]
        assert "restaurant-tips.md" in config.load_rules[0].skip[0]
        assert "Understand" in config.process
        assert "CRM" in config.guardrails

    def test_simple_parse(self, tmp_path):
        ctx_file = tmp_path / "CONTEXT.md"
        ctx_file.write_text(SIMPLE_CONTEXT)

        config = parse_context_md(str(ctx_file), slug="research")

        assert config is not None
        assert config.name == "Research"
        assert config.model == ""
        assert len(config.skills) == 1
        assert config.skills[0].name == "Web Search"

    def test_no_skills(self, tmp_path):
        ctx_file = tmp_path / "CONTEXT.md"
        ctx_file.write_text(NO_SKILLS_CONTEXT)

        config = parse_context_md(str(ctx_file), slug="docs")

        assert config is not None
        assert config.name == "Documentation"
        assert len(config.skills) == 0  # No skills section with table

    def test_missing_file(self):
        config = parse_context_md("/nonexistent/CONTEXT.md")
        assert config is None

    def test_empty_file(self, tmp_path):
        ctx_file = tmp_path / "CONTEXT.md"
        ctx_file.write_text("")
        config = parse_context_md(str(ctx_file))
        assert config is None

    def test_slug_from_folder(self, tmp_path):
        ws_dir = tmp_path / "my-workspace"
        ws_dir.mkdir()
        ctx_file = ws_dir / "CONTEXT.md"
        ctx_file.write_text("# My Workspace\n\n## What This Workspace Is\nTest.")

        config = parse_context_md(str(ctx_file))
        assert config is not None
        assert config.slug == "my-workspace"


class TestDiscoverWorkspaces:
    def test_discovers_workspaces(self, tmp_path):
        # Create two workspace folders with CONTEXT.md
        (tmp_path / "personal-assistant").mkdir()
        (tmp_path / "personal-assistant" / "CONTEXT.md").write_text(SAMPLE_CONTEXT)
        (tmp_path / "research").mkdir()
        (tmp_path / "research" / "CONTEXT.md").write_text(SIMPLE_CONTEXT)
        # Create a folder without CONTEXT.md (should be skipped)
        (tmp_path / "docs").mkdir()
        (tmp_path / "docs" / "readme.md").write_text("# Docs")
        # Create a regular file (should be skipped)
        (tmp_path / "SOUL.md").write_text("# Soul")

        configs = discover_workspaces(str(tmp_path))

        assert len(configs) == 2
        slugs = [c.slug for c in configs]
        assert "personal-assistant" in slugs
        assert "research" in slugs

    def test_skips_hidden_dirs(self, tmp_path):
        (tmp_path / ".hidden").mkdir()
        (tmp_path / ".hidden" / "CONTEXT.md").write_text("# Hidden")
        (tmp_path / "_internal").mkdir()
        (tmp_path / "_internal" / "CONTEXT.md").write_text("# Internal")

        configs = discover_workspaces(str(tmp_path))
        assert len(configs) == 0

    def test_empty_dir(self, tmp_path):
        configs = discover_workspaces(str(tmp_path))
        assert len(configs) == 0

    def test_nonexistent_dir(self):
        configs = discover_workspaces("/nonexistent")
        assert len(configs) == 0
