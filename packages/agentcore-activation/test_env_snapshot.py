import sys
from pathlib import Path

sys.path.insert(
    0,
    str(Path(__file__).parent / "agent-container" / "container-sources"),
)

from env_snapshot import snapshot_at_entry


def test_snapshot_at_entry_reads_expected_keys(monkeypatch):
    monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
    monkeypatch.setenv("API_AUTH_SECRET", "secret")
    monkeypatch.setenv("TENANT_ID", "tenant-a")

    assert snapshot_at_entry() == {
        "THINKWORK_API_URL": "https://api.example.com",
        "API_AUTH_SECRET": "secret",
        "TENANT_ID": "tenant-a",
    }
