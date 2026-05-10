import importlib.util
import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch


def load_module(monkeypatch):
    monkeypatch.setenv("DATABASE_CLUSTER_ARN", "cluster")
    monkeypatch.setenv("DATABASE_SECRET_ARN", "secret")
    monkeypatch.setenv("TENANT_ID", "tenant-1")
    monkeypatch.setenv("AGENT_ID", "11111111-1111-4111-8111-111111111111")
    monkeypatch.setenv("WORKSPACE_BUCKET", "workspace-bucket")
    rds = MagicMock()
    rds.execute_statement.return_value = {
        "formattedRecords": json.dumps(
            [{"id": "artifact-1", "title": "Report", "type": "report", "status": "final"}]
        )
    }
    s3 = MagicMock()

    def client(service, **_kwargs):
        return rds if service == "rds-data" else s3

    path = Path(__file__).with_name("artifacts.py")
    spec = importlib.util.spec_from_file_location("artifact_skill_under_test", path)
    module = importlib.util.module_from_spec(spec)
    boto3 = types.SimpleNamespace(client=MagicMock(side_effect=client))
    monkeypatch.setitem(sys.modules, "boto3", boto3)
    spec.loader.exec_module(module)
    return module, rds, s3


def test_create_artifact_writes_payload_to_s3_before_insert(monkeypatch):
    module, rds, s3 = load_module(monkeypatch)

    with patch.object(module.uuid, "uuid4", return_value="artifact-1"):
        result = json.loads(module.create_artifact("Report", "report", "# Report"))

    assert result["id"] == "artifact-1"
    s3.put_object.assert_called_once()
    assert s3.put_object.call_args.kwargs["Bucket"] == "workspace-bucket"
    assert (
        s3.put_object.call_args.kwargs["Key"]
        == "tenants/tenant-1/artifact-payloads/artifacts/artifact-1/content.md"
    )
    sql = rds.execute_statement.call_args.kwargs["sql"]
    assert "content, s3_key" in sql
    assert "NULL, :s3_key" in sql


def test_update_artifact_writes_payload_to_revision_key(monkeypatch):
    module, rds, s3 = load_module(monkeypatch)

    with patch.object(module.uuid, "uuid4", return_value="revision-1"):
        module.update_artifact("artifact-1", content="next")

    assert (
        s3.put_object.call_args.kwargs["Key"]
        == "tenants/tenant-1/artifact-payloads/artifacts/artifact-1/content/revision-1.md"
    )
    sql = rds.execute_statement.call_args.kwargs["sql"]
    assert "content = NULL" in sql
    assert "s3_key = :s3_key" in sql
