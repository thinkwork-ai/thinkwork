from __future__ import annotations

from types import SimpleNamespace

import computer_task_events


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return b'{"id":"event-1","eventType":"browser_automation_started"}'


def test_append_computer_task_event_posts_runtime_event(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["headers"] = dict(request.header_items())
        captured["body"] = request.data.decode("utf-8")
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(
        computer_task_events.urllib,
        "request",
        SimpleNamespace(
            Request=computer_task_events.urllib.request.Request,
            urlopen=fake_urlopen,
        ),
    )

    result = computer_task_events.append_computer_task_event(
        tenant_id="tenant-1",
        computer_id="computer-1",
        task_id="task-1",
        event_type="browser_automation_started",
        level="info",
        payload={"url": "https://example.test"},
        api_url="https://api.example.test/",
        api_secret="service-secret",
        timeout=3,
    )

    assert result["id"] == "event-1"
    assert captured["url"] == (
        "https://api.example.test/api/computers/runtime/tasks/task-1/events"
    )
    assert captured["headers"]["Authorization"] == "Bearer service-secret"
    assert '"eventType": "browser_automation_started"' in captured["body"]
    assert '"url": "https://example.test"' in captured["body"]
    assert captured["timeout"] == 3
