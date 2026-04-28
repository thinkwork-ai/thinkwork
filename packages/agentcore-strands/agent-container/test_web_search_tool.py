from __future__ import annotations

import json

import web_search_tool


def test_web_search_tool_uses_exa_and_returns_results(monkeypatch):
    calls = []

    def fake_post_json(url, *, headers, payload):
        calls.append((url, headers, payload))
        return {
            "results": [
                {
                    "title": "OpenAI News",
                    "url": "https://openai.com/news/",
                    "text": "Latest news from OpenAI.",
                }
            ]
        }

    monkeypatch.setattr(web_search_tool, "_post_json", fake_post_json)
    costs = []
    tool = web_search_tool.build_web_search_tool(
        strands_tool_decorator=lambda fn: fn,
        web_search_config={"provider": "exa", "apiKey": "test-key"},
        cost_sink=costs,
    )

    result = json.loads(tool("OpenAI news", 3))

    assert result["ok"] is True
    assert result["provider"] == "exa"
    assert result["result_count"] == 1
    assert result["results"][0]["title"] == "OpenAI News"
    assert calls[0][1]["x-api-key"] == "test-key"
    assert calls[0][2]["numResults"] == 3
    assert costs[0]["event_type"] == "web_search"


def test_web_search_tool_reports_missing_key_without_http_call(monkeypatch):
    monkeypatch.setattr(
        web_search_tool,
        "_post_json",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no http")),
    )
    tool = web_search_tool.build_web_search_tool(
        strands_tool_decorator=lambda fn: fn,
        web_search_config={"provider": "exa"},
        cost_sink=[],
    )

    result = json.loads(tool("OpenAI news"))

    assert result["ok"] is False
    assert result["result_count"] == 0
    assert "API key" in result["error"]
