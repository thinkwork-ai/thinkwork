"""E2E coverage for the live ``delegate_to_workspace`` sub-agent path.

This test intentionally exercises the production factory shape:
``spawn_fn=None``. Bedrock and Strands are replaced with tiny constructor
stubs, but the rest of the path is real: local workspace read, AGENTS.md
parsing, skill resolution, prompt construction, tool list construction, child
agent invocation, and usage capture.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _write(root: Path, rel: str, body: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def test_delegate_to_workspace_live_spawn_uses_workspace_and_skill_tool(tmp_path):
    from delegate_to_workspace_tool import make_delegate_to_workspace_fn

    _write(tmp_path, "PLATFORM.md", "Platform rules.\n")
    _write(tmp_path, "GUARDRAILS.md", "Guardrail rules.\n")
    _write(
        tmp_path,
        "research/AGENTS.md",
        """# Research sub-agent

## Routing

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Answer restaurants | research/ | CONTEXT.md | restaurant-research |
""",
    )
    _write(
        tmp_path,
        "research/CONTEXT.md",
        "You handle focused restaurant-memory research.\n",
    )
    _write(
        tmp_path,
        "research/skills/restaurant-research/SKILL.md",
        """---
name: restaurant-research
description: Search restaurant memories
---
Use the available source tools, cite what you found, and do not guess.
""",
    )

    captured: dict[str, Any] = {}

    def model_factory(**kwargs):
        captured["model_kwargs"] = kwargs
        return {"model": "stub"}

    class StubResult:
        def __init__(self, text: str):
            self.text = text
            self.metrics = type(
                "Metrics",
                (),
                {"accumulated_usage": {"inputTokens": 11, "outputTokens": 7}},
            )()

        def __str__(self) -> str:
            return self.text

    class StubAgent:
        def __init__(self, **kwargs):
            captured["agent_kwargs"] = kwargs

        def __call__(self, task: str):
            tools = {
                getattr(tool, "__name__", ""): tool
                for tool in captured["agent_kwargs"]["tools"]
            }
            skill_body = tools["restaurant_research"]()
            return StubResult(f"child handled {task}; skill={skill_body[:32]}")

    usage_acc: list[dict[str, int]] = []
    tool = make_delegate_to_workspace_fn(
        parent_tenant_id="tenant-1",
        parent_agent_id="agent-parent",
        api_url="https://api.example.test",
        api_secret="secret",
        platform_catalog_manifest=None,
        cfg_model="anthropic.test-model",
        usage_acc=usage_acc,
        workspace_dir=str(tmp_path),
        aws_region="us-east-1",
        model_factory=model_factory,
        agent_factory=StubAgent,
        tool_decorator=lambda fn: fn,
        tool_context={
            "knowledge_pack_body": "<user_distilled_knowledge>Paris notes</user_distilled_knowledge>",
        },
    )

    result = tool(path="research", task="find my favorite restaurant in Paris")

    assert result["ok"] is True
    assert "find my favorite restaurant in Paris" in result["sub_agent_response"]
    assert "restaurant-research" in result["sub_agent_response"]
    assert result["sub_agent_usage"] == {"input_tokens": 11, "output_tokens": 7}
    assert usage_acc == [{"input_tokens": 11, "output_tokens": 7}]
    assert captured["model_kwargs"]["model_id"] == "anthropic.test-model"
    assert captured["model_kwargs"]["region_name"] == "us-east-1"

    system_prompt = captured["agent_kwargs"]["system_prompt"]
    assert "Platform rules." in system_prompt
    assert "Guardrail rules." in system_prompt
    assert "restaurant-memory research" in system_prompt
    assert "<user_distilled_knowledge>Paris notes" in system_prompt

    tool_names = {tool.__name__ for tool in captured["agent_kwargs"]["tools"]}
    assert "restaurant_research" in tool_names
