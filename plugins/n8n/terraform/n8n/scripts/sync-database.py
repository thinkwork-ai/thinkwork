#!/usr/bin/env python3
"""Synchronize the dedicated n8n Postgres database and role.

The managed app can create fresh runtime secrets while the shared Aurora role
survives a teardown. This script makes the Terraform lifecycle idempotent by
rotating the role password to match the runtime secret before ECS starts n8n.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.parse

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def validate_identifier(value: str, label: str) -> str:
    if not IDENTIFIER.fullmatch(value):
        raise RuntimeError(f"{label} must be a valid PostgreSQL identifier")
    return value


def quote_ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def get_secret(secret_id: str) -> dict[str, object]:
    raw = subprocess.check_output(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            secret_id,
            "--output",
            "json",
        ],
        text=True,
    )
    payload = json.loads(raw)
    secret_string = payload.get("SecretString") or ""
    if not isinstance(secret_string, str) or not secret_string:
        raise RuntimeError(f"Secret {secret_id} has no SecretString")
    try:
        parsed = json.loads(secret_string)
    except json.JSONDecodeError:
        return {"DATABASE_URL": secret_string}
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Secret {secret_id} must contain a JSON object")
    return parsed


def first_string(secret: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = secret.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def parse_url(value: str) -> urllib.parse.ParseResult | None:
    if not value:
        return None
    parsed = urllib.parse.urlparse(value)
    if not parsed.scheme or not parsed.hostname:
        return None
    return parsed


def admin_connection(secret: dict[str, object]) -> dict[str, str]:
    host = require_env("N8N_DATABASE_HOST")
    port = require_env("N8N_DATABASE_PORT")
    url = first_string(secret, "DATABASE_URL", "PG_DATABASE_URL", "databaseUrl", "url")
    parsed = parse_url(url)
    username = ""
    password = ""
    if parsed:
        username = urllib.parse.unquote(parsed.username or "")
        password = urllib.parse.unquote(parsed.password or "")
        host = parsed.hostname or host
        port = str(parsed.port or port)
    username = username or first_string(secret, "username", "user", "USERNAME", "PGUSER")
    password = password or first_string(secret, "password", "PASSWORD", "PGPASSWORD")
    if not username or not password:
        raise RuntimeError("Admin database secret must contain username and password")
    return {
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "maintenance_db": first_string(secret, "maintenanceDatabase", "maintenance_database")
        or "postgres",
    }


def runtime_password(secret: dict[str, object]) -> str:
    password = first_string(secret, "DB_POSTGRESDB_PASSWORD", "password", "PASSWORD")
    if password:
        return password
    parsed = parse_url(first_string(secret, "DATABASE_URL", "PG_DATABASE_URL", "databaseUrl"))
    if parsed and parsed.password:
        return urllib.parse.unquote(parsed.password)
    raise RuntimeError("n8n runtime database secret is missing DB_POSTGRESDB_PASSWORD")


def psql(conn: dict[str, str], database: str, sql: str, capture: bool = False) -> str:
    env = os.environ.copy()
    env["PGPASSWORD"] = conn["password"]
    env["PGSSLMODE"] = "require"
    args = [
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        conn["host"],
        "-p",
        conn["port"],
        "-U",
        conn["username"],
        "-d",
        database,
        "-q",
    ]
    if capture:
        args.append("-tA")
    completed = subprocess.run(
        args,
        input=sql,
        text=True,
        env=env,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"psql exited {completed.returncode}"
        raise RuntimeError(detail)
    return completed.stdout.strip() if capture and completed.stdout else ""


def sync_up() -> None:
    database_name = validate_identifier(require_env("N8N_DATABASE_NAME"), "database_name")
    database_username = validate_identifier(
        require_env("N8N_DATABASE_USERNAME"), "database_username"
    )
    admin = admin_connection(get_secret(require_env("N8N_DATABASE_ADMIN_SECRET_ARN")))
    password = runtime_password(get_secret(require_env("N8N_DATABASE_URL_SECRET_ARN")))
    db_ident = quote_ident(database_name)
    role_ident = quote_ident(database_username)

    psql(
        admin,
        admin["maintenance_db"],
        f"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = {quote_literal(database_username)}) THEN
    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', {quote_literal(database_username)}, {quote_literal(password)});
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', {quote_literal(database_username)}, {quote_literal(password)});
  END IF;
END $$;
""",
    )

    exists = psql(
        admin,
        admin["maintenance_db"],
        f"SELECT 1 FROM pg_database WHERE datname = {quote_literal(database_name)};",
        capture=True,
    )
    if exists != "1":
        psql(admin, admin["maintenance_db"], f"CREATE DATABASE {db_ident} OWNER {role_ident};")

    psql(
        admin,
        admin["maintenance_db"],
        f"""
ALTER DATABASE {db_ident} OWNER TO {role_ident};
GRANT ALL PRIVILEGES ON DATABASE {db_ident} TO {role_ident};
""",
    )
    psql(
        admin,
        database_name,
        f"""
CREATE SCHEMA IF NOT EXISTS public;
ALTER SCHEMA public OWNER TO {role_ident};
GRANT ALL ON SCHEMA public TO {role_ident};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {role_ident};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {role_ident};
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO {role_ident};
""",
    )
    print(f"[n8n-db] synchronized database {database_name} and role {database_username}")


def sync_destroy() -> None:
    database_name = validate_identifier(require_env("N8N_DATABASE_NAME"), "database_name")
    database_username = validate_identifier(
        require_env("N8N_DATABASE_USERNAME"), "database_username"
    )
    admin = admin_connection(get_secret(require_env("N8N_DATABASE_ADMIN_SECRET_ARN")))
    db_ident = quote_ident(database_name)
    role_ident = quote_ident(database_username)
    psql(
        admin,
        admin["maintenance_db"],
        f"""
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = {quote_literal(database_name)}
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS {db_ident};
DROP ROLE IF EXISTS {role_ident};
""",
    )
    print(f"[n8n-db] dropped database {database_name} and role {database_username}")


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "up"
    if mode == "up":
        sync_up()
    elif mode == "destroy":
        sync_destroy()
    else:
        raise RuntimeError(f"Unsupported mode: {mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
