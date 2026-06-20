from __future__ import annotations

import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("sync-database.py")


def load_module():
    spec = importlib.util.spec_from_file_location("sync_database", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sync_up_creates_admin_owned_database_and_grants_runtime_role(monkeypatch):
    module = load_module()
    calls: list[tuple[str, str]] = []

    monkeypatch.setenv("N8N_DATABASE_NAME", "thinkwork_n8n")
    monkeypatch.setenv("N8N_DATABASE_USERNAME", "thinkwork_n8n")
    monkeypatch.setenv("N8N_DATABASE_ADMIN_SECRET_ARN", "admin-secret")
    monkeypatch.setenv("N8N_DATABASE_URL_SECRET_ARN", "runtime-secret")
    monkeypatch.setenv("N8N_DATABASE_HOST", "db.example.test")
    monkeypatch.setenv("N8N_DATABASE_PORT", "5432")

    def fake_get_secret(secret_id: str):
        if secret_id == "admin-secret":
            return {
                "username": "thinkwork_admin",
                "password": "admin-password",
                "maintenanceDatabase": "postgres",
            }
        if secret_id == "runtime-secret":
            return {"DB_POSTGRESDB_PASSWORD": "runtime-password"}
        raise AssertionError(secret_id)

    def fake_psql(conn, database, sql, capture=False):
        calls.append((database, sql))
        if capture:
            return ""
        return ""

    monkeypatch.setattr(module, "get_secret", fake_get_secret)
    monkeypatch.setattr(module, "psql", fake_psql)

    module.sync_up()

    sql = "\n".join(statement for _, statement in calls)
    assert 'CREATE DATABASE "thinkwork_n8n";' in sql
    assert 'CREATE DATABASE "thinkwork_n8n" OWNER "thinkwork_n8n"' not in sql
    assert 'ALTER DATABASE "thinkwork_n8n" OWNER TO "thinkwork_n8n"' not in sql
    assert 'GRANT CONNECT, TEMPORARY ON DATABASE "thinkwork_n8n" TO "thinkwork_n8n"' in sql
    assert 'GRANT USAGE, CREATE ON SCHEMA public TO "thinkwork_n8n"' in sql
