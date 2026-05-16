from __future__ import annotations

from unittest.mock import patch

from slack_post_back import build_slack_post_back_client


def test_slack_post_back_client_snapshots_env_and_payload_before_post():
    payload = {
        "sessionId": "tenant-1",
        "computer_id": "computer-1",
        "computer_task_id": "task-1",
        "slack": {"slackTeamId": "T123", "channelId": "C123"},
    }

    with patch.dict(
        "os.environ",
        {
            "THINKWORK_API_URL": "https://api.initial.test/",
            "API_AUTH_SECRET": "initial-secret",
        },
        clear=False,
    ):
        client = build_slack_post_back_client(payload)
        assert client is not None
        assert client.available is True

    with patch.dict(
        "os.environ",
        {
            "THINKWORK_API_URL": "https://api.mutated.test/",
            "API_AUTH_SECRET": "mutated-secret",
        },
        clear=False,
    ):
        with patch(
            "slack_post_back.record_thread_turn_response",
            return_value={"responded": True},
        ) as record_response:
            result = client.post_response(
                content="Done",
                model="model-1",
                usage={"output_tokens": 5},
            )

    assert result == {"responded": True}
    record_response.assert_called_once_with(
        tenant_id="tenant-1",
        computer_id="computer-1",
        task_id="task-1",
        content="Done",
        model="model-1",
        usage={"output_tokens": 5},
        source="slack",
        api_url="https://api.initial.test",
        api_secret="initial-secret",
    )


def test_slack_post_back_client_uses_payload_auth_before_env():
    payload = {
        "sessionId": "tenant-1",
        "computerId": "computer-1",
        "computerTaskId": "task-1",
        "thinkwork_api_url": "https://api.payload.test/",
        "thinkwork_api_secret": "payload-secret",
        "slack": {"slackTeamId": "T123"},
    }

    with patch.dict(
        "os.environ",
        {
            "THINKWORK_API_URL": "https://api.env.test/",
            "API_AUTH_SECRET": "env-secret",
        },
        clear=False,
    ):
        client = build_slack_post_back_client(payload)

    assert client is not None
    assert client.api_url == "https://api.payload.test"
    assert client.api_secret == "payload-secret"


def test_slack_post_back_client_absent_without_slack_envelope():
    assert build_slack_post_back_client({"sessionId": "tenant-1"}) is None
