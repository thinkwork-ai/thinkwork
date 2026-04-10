"""Tests for router_parser.py — ROUTER.md parsing and profile resolution."""
import os
import tempfile
import pytest
from router_parser import parse_router, resolve_profile, expand_file_list, filter_skills, ContextProfile


SAMPLE_ROUTER = """# Workspace Router

## default
- load: SOUL.md, IDENTITY.md, USER.md
- skills: all

## chat
- load: docs/tone.md, memory/preferences.md
- skills: all

## email
- load: docs/procedures/email-triage.md, templates/email/
- skills: agent-email-send, google-email

## heartbeat
- load: docs/procedures/
- skip: IDENTITY.md, USER.md
- skills: ticket-management

## process:onboarding:step-1
- load: docs/tone.md, templates/email/welcome.md
- skills: agent-email-send
"""


@pytest.fixture
def workspace(tmp_path):
    """Create a workspace directory with sample files."""
    ws = tmp_path / "workspace"
    ws.mkdir()

    # Root files
    (ws / "SOUL.md").write_text("You are a helpful agent.")
    (ws / "IDENTITY.md").write_text("Name: Nova")
    (ws / "USER.md").write_text("User: Eric")
    (ws / "ROUTER.md").write_text(SAMPLE_ROUTER)

    # docs/
    (ws / "docs").mkdir()
    (ws / "docs" / "tone.md").write_text("Be friendly and concise.")
    (ws / "docs" / "procedures").mkdir()
    (ws / "docs" / "procedures" / "email-triage.md").write_text("Triage steps...")
    (ws / "docs" / "procedures" / "escalation.md").write_text("Escalation steps...")

    # templates/
    (ws / "templates").mkdir()
    (ws / "templates" / "email").mkdir()
    (ws / "templates" / "email" / "welcome.md").write_text("Welcome template")
    (ws / "templates" / "email" / "follow-up.md").write_text("Follow-up template")

    # memory/
    (ws / "memory").mkdir()
    (ws / "memory" / "preferences.md").write_text("User prefers concise answers.")

    return ws


@pytest.fixture
def router_path(workspace):
    return str(workspace / "ROUTER.md")


class TestParseRouter:
    def test_parses_all_profiles(self, router_path):
        profiles = parse_router(router_path)
        assert set(profiles.keys()) == {"default", "chat", "email", "heartbeat", "process:onboarding:step-1"}

    def test_default_profile(self, router_path):
        profiles = parse_router(router_path)
        default = profiles["default"]
        assert default.load == ["SOUL.md", "IDENTITY.md", "USER.md"]
        assert default.skills == ["all"]
        assert default.skip == []

    def test_email_profile(self, router_path):
        profiles = parse_router(router_path)
        email = profiles["email"]
        assert email.load == ["docs/procedures/email-triage.md", "templates/email/"]
        assert email.skills == ["agent-email-send", "google-email"]

    def test_heartbeat_has_skip(self, router_path):
        profiles = parse_router(router_path)
        hb = profiles["heartbeat"]
        assert hb.skip == ["IDENTITY.md", "USER.md"]
        assert hb.skills == ["ticket-management"]

    def test_missing_file_returns_empty(self, tmp_path):
        profiles = parse_router(str(tmp_path / "nonexistent.md"))
        assert profiles == {}


class TestResolveProfile:
    def test_channel_match_chat(self, router_path):
        profile = resolve_profile(router_path, channel="chat")
        # default (SOUL, IDENTITY, USER) + chat (tone, preferences)
        assert "SOUL.md" in profile.load
        assert "IDENTITY.md" in profile.load
        assert "USER.md" in profile.load
        assert "docs/tone.md" in profile.load
        assert "memory/preferences.md" in profile.load
        assert profile.skills == ["all"]

    def test_channel_match_email(self, router_path):
        profile = resolve_profile(router_path, channel="email")
        # default + email additions
        assert "SOUL.md" in profile.load
        assert "IDENTITY.md" in profile.load
        assert "docs/procedures/email-triage.md" in profile.load
        assert "templates/email/" in profile.load
        assert profile.skills == ["agent-email-send", "google-email"]

    def test_heartbeat_skip(self, router_path):
        profile = resolve_profile(router_path, channel="heartbeat")
        assert "SOUL.md" in profile.load
        assert "IDENTITY.md" not in profile.load
        assert "USER.md" not in profile.load
        assert "docs/procedures/" in profile.load
        assert profile.skills == ["ticket-management"]

    def test_process_step_match(self, router_path):
        profile = resolve_profile(router_path, channel="chat",
                                  context_profile="process:onboarding:step-1")
        # Process step takes priority over channel
        assert "SOUL.md" in profile.load
        assert "docs/tone.md" in profile.load
        assert "templates/email/welcome.md" in profile.load
        assert profile.skills == ["agent-email-send"]

    def test_unknown_channel_falls_to_default(self, router_path):
        profile = resolve_profile(router_path, channel="unknown_channel")
        assert profile.load == ["SOUL.md", "IDENTITY.md", "USER.md"]
        assert profile.skills == ["all"]

    def test_no_channel_falls_to_default(self, router_path):
        profile = resolve_profile(router_path, channel="")
        assert profile.load == ["SOUL.md", "IDENTITY.md", "USER.md"]
        assert profile.skills == ["all"]

    def test_no_router_returns_none(self, tmp_path):
        profile = resolve_profile(str(tmp_path / "nonexistent.md"), channel="chat")
        assert profile is None

    def test_context_profile_takes_priority_over_channel(self, router_path):
        profile = resolve_profile(router_path, channel="email",
                                  context_profile="process:onboarding:step-1")
        # Should match process step, not email
        assert profile.skills == ["agent-email-send"]
        assert "templates/email/welcome.md" in profile.load


class TestExpandFileList:
    def test_single_file(self, workspace):
        result = expand_file_list(str(workspace), ["SOUL.md"])
        assert result == ["SOUL.md"]

    def test_directory_expansion(self, workspace):
        result = expand_file_list(str(workspace), ["templates/email/"])
        assert "templates/email/follow-up.md" in result
        assert "templates/email/welcome.md" in result

    def test_mixed_files_and_dirs(self, workspace):
        result = expand_file_list(str(workspace), ["SOUL.md", "docs/procedures/"])
        assert "SOUL.md" in result
        assert "docs/procedures/email-triage.md" in result
        assert "docs/procedures/escalation.md" in result

    def test_missing_file_skipped(self, workspace):
        result = expand_file_list(str(workspace), ["SOUL.md", "nonexistent.md"])
        assert result == ["SOUL.md"]

    def test_deduplication(self, workspace):
        result = expand_file_list(str(workspace), ["SOUL.md", "SOUL.md"])
        assert result.count("SOUL.md") == 1


class TestFilterSkills:
    def test_all_returns_everything(self):
        skills = [{"skillId": "a"}, {"skillId": "b"}]
        assert filter_skills(skills, ["all"]) == skills

    def test_per_job_returns_everything(self):
        skills = [{"skillId": "a"}, {"skillId": "b"}]
        assert filter_skills(skills, ["per-job"]) == skills

    def test_specific_slugs_filter(self):
        skills = [{"skillId": "a"}, {"skillId": "b"}, {"skillId": "c"}]
        result = filter_skills(skills, ["a", "c"])
        assert len(result) == 2
        assert result[0]["skillId"] == "a"
        assert result[1]["skillId"] == "c"

    def test_empty_profile_returns_all(self):
        skills = [{"skillId": "a"}]
        assert filter_skills(skills, []) == skills
