import base64
import importlib.util
import io
import json
import os
import re
import subprocess
import tarfile
from hashlib import sha256
from pathlib import Path

import pytest


def load_runner():
    runner_path = Path(__file__).with_name("runner.py")
    spec = importlib.util.spec_from_file_location("deployment_control_runner", runner_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_tar(path: Path, files: dict[str, bytes]) -> None:
    with tarfile.open(path, "w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def file_url(path: Path) -> str:
    return path.resolve().as_uri()


def digest(data: bytes) -> str:
    return sha256(data).hexdigest()


def write_manifest(path: Path, manifest: dict) -> str:
    encoded = json.dumps(manifest, sort_keys=True).encode()
    path.write_bytes(encoded)
    return digest(encoded)


def release_manifest(
    bundle_path: Path,
    bundle_sha: str,
    artifacts: list[dict],
    version: str = "0.1.0-canary.134",
) -> dict:
    return {
        "schemaVersion": 1,
        "release": {
            "version": version,
            "gitSha": "abc123",
            "createdAt": "2026-06-09T00:00:00.000Z",
        },
        "artifactBundles": [
            {
                "name": "platform",
                "fileName": "platform-artifacts.tar.gz",
                "relativePath": "platform-artifacts.tar.gz",
                "url": file_url(bundle_path),
                "sha256": bundle_sha,
                "sizeBytes": bundle_path.stat().st_size,
                "contains": [artifact["name"] for artifact in artifacts],
            }
        ],
        "artifacts": artifacts,
        "runtimeImages": [],
        "managedApps": [],
        "signing": {
            "acceptedKeyIds": [],
            "revokedKeyIds": [],
        },
    }


def write_drizzle_files(source_dir: Path, names: list[str]) -> None:
    migrations = source_dir / "packages/database-pg/drizzle"
    migrations.mkdir(parents=True)
    for name in names:
        (migrations / name).write_text(f"-- {name}\n", encoding="utf-8")


def test_sync_release_artifacts_stages_artifacts_from_platform_bundle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "thinkwork-release.json"
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    lambda_bytes = b"lambda-zip"
    web_bytes = b"web-tarball"
    write_tar(
        bundle_path,
        {
            "lambdas/graphql-http.zip": lambda_bytes,
            "static/web.tar.gz": web_bytes,
        },
    )
    artifacts = [
        {
            "name": "graphql-http",
            "type": "lambda",
            "fileName": "graphql-http.zip",
            "relativePath": "lambdas/graphql-http.zip",
            "url": None,
            "sha256": digest(lambda_bytes),
            "sizeBytes": len(lambda_bytes),
        },
        {
            "name": "web",
            "type": "static-site",
            "fileName": "web.tar.gz",
            "relativePath": "static/web.tar.gz",
            "url": None,
            "sha256": digest(web_bytes),
            "sizeBytes": len(web_bytes),
        },
    ]
    manifest_sha = write_manifest(
        manifest_path,
        release_manifest(bundle_path, runner.sha256_file(bundle_path), artifacts),
    )
    calls: list[list[str]] = []

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setattr(runner, "RELEASE_EVIDENCE", {})
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "0.1.0-canary.134")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    static_files = runner.sync_release_artifacts()

    assert static_files["web"].read_bytes() == web_bytes
    assert calls == [
        [
            "aws",
            "s3",
            "cp",
            str(release_dir / "lambdas/graphql-http.zip"),
            "s3://thinkwork-artifacts/releases/0.1.0-canary.134/lambdas/graphql-http.zip",
        ]
    ]
    assert runner.RELEASE_EVIDENCE["manifestSha256"] == manifest_sha
    assert runner.RELEASE_EVIDENCE["trust"] == {
        "policy": "allow_unsigned_canary",
        "signatureRequired": False,
        "signatureVerified": False,
        "unsignedCanaryAllowed": True,
    }
    assert runner.RELEASE_EVIDENCE["bundles"][0]["contains"] == ["graphql-http", "web"]
    assert {artifact["source"] for artifact in runner.RELEASE_EVIDENCE["artifacts"]} == {"bundle"}


def test_sync_release_artifacts_can_materialize_only_web_static_bundle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "thinkwork-release.json"
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    lambda_bytes = b"lambda-zip"
    web_bytes = b"web-tarball"
    docs_bytes = b"docs-tarball"
    write_tar(
        bundle_path,
        {
            "lambdas/graphql-http.zip": lambda_bytes,
            "static/web.tar.gz": web_bytes,
            "static/docs.tar.gz": docs_bytes,
        },
    )
    artifacts = [
        {
            "name": "graphql-http",
            "type": "lambda",
            "fileName": "graphql-http.zip",
            "relativePath": "lambdas/graphql-http.zip",
            "url": None,
            "sha256": digest(lambda_bytes),
            "sizeBytes": len(lambda_bytes),
        },
        {
            "name": "web",
            "type": "static-site",
            "fileName": "web.tar.gz",
            "relativePath": "static/web.tar.gz",
            "url": None,
            "sha256": digest(web_bytes),
            "sizeBytes": len(web_bytes),
        },
        {
            "name": "docs",
            "type": "static-site",
            "fileName": "docs.tar.gz",
            "relativePath": "static/docs.tar.gz",
            "url": None,
            "sha256": digest(docs_bytes),
            "sizeBytes": len(docs_bytes),
        },
    ]
    manifest_sha = write_manifest(
        manifest_path,
        release_manifest(bundle_path, runner.sha256_file(bundle_path), artifacts),
    )
    calls: list[list[str]] = []

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setattr(runner, "RELEASE_EVIDENCE", {})
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "0.1.0-canary.134")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    static_files = runner.sync_release_artifacts(
        artifact_types={"static-site"},
        artifact_names={"web"},
    )

    assert static_files == {"web": release_dir / "static/web.tar.gz"}
    assert static_files["web"].read_bytes() == web_bytes
    assert calls == []
    assert [artifact["name"] for artifact in runner.RELEASE_EVIDENCE["artifacts"]] == ["web"]


def test_sync_release_artifacts_requires_signature_for_non_canary_release(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "thinkwork-release.json"
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    lambda_bytes = b"lambda-zip"
    write_tar(bundle_path, {"lambdas/graphql-http.zip": lambda_bytes})
    artifacts = [
        {
            "name": "graphql-http",
            "type": "lambda",
            "fileName": "graphql-http.zip",
            "relativePath": "lambdas/graphql-http.zip",
            "url": None,
            "sha256": digest(lambda_bytes),
            "sizeBytes": len(lambda_bytes),
        }
    ]
    manifest_sha = write_manifest(
        manifest_path,
        release_manifest(
            bundle_path,
            runner.sha256_file(bundle_path),
            artifacts,
            version="1.0.0",
        ),
    )
    calls: list[list[str]] = []

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setattr(runner, "RELEASE_EVIDENCE", {})
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "1.0.0")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    with pytest.raises(RuntimeError, match="Unsigned release manifest is only allowed"):
        runner.sync_release_artifacts()

    assert calls == []
    assert runner.RELEASE_EVIDENCE == {}


def test_sync_release_artifacts_require_signature_policy_fails_without_signature_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "custom-manifest.json"
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    lambda_bytes = b"lambda-zip"
    write_tar(bundle_path, {"lambdas/graphql-http.zip": lambda_bytes})
    artifacts = [
        {
            "name": "graphql-http",
            "type": "lambda",
            "fileName": "graphql-http.zip",
            "relativePath": "lambdas/graphql-http.zip",
            "url": None,
            "sha256": digest(lambda_bytes),
            "sizeBytes": len(lambda_bytes),
        }
    ]
    manifest_sha = write_manifest(
        manifest_path,
        release_manifest(bundle_path, runner.sha256_file(bundle_path), artifacts),
    )
    calls: list[list[str]] = []

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setattr(runner, "RELEASE_EVIDENCE", {})
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_TRUST_POLICY", "require_signature")
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "0.1.0-canary.134")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    with pytest.raises(RuntimeError, match="signature URL is required"):
        runner.sync_release_artifacts()

    assert calls == []
    assert runner.RELEASE_EVIDENCE == {}


def test_sync_release_artifacts_verifies_detached_manifest_signature(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "thinkwork-release.json"
    signature_path = tmp_path / "thinkwork-release.sig.json"
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    private_key_path = tmp_path / "private.pem"
    public_key_path = tmp_path / "public.pem"
    canonical_path = tmp_path / "manifest.canonical.json"
    signature_bytes_path = tmp_path / "thinkwork-release.sig"
    lambda_bytes = b"lambda-zip"
    write_tar(bundle_path, {"lambdas/graphql-http.zip": lambda_bytes})
    artifacts = [
        {
            "name": "graphql-http",
            "type": "lambda",
            "fileName": "graphql-http.zip",
            "relativePath": "lambdas/graphql-http.zip",
            "url": None,
            "sha256": digest(lambda_bytes),
            "sizeBytes": len(lambda_bytes),
        }
    ]
    manifest = release_manifest(
        bundle_path,
        runner.sha256_file(bundle_path),
        artifacts,
        version="1.0.0",
    )
    manifest["signing"]["acceptedKeyIds"] = ["test-key"]
    manifest_sha = write_manifest(manifest_path, manifest)
    canonical_path.write_bytes(runner.stable_json_bytes(manifest))

    subprocess.run(
        ["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(private_key_path)],
        check=True,
    )
    subprocess.run(
        ["openssl", "pkey", "-in", str(private_key_path), "-pubout", "-out", str(public_key_path)],
        check=True,
    )
    subprocess.run(
        [
            "openssl",
            "pkeyutl",
            "-sign",
            "-rawin",
            "-inkey",
            str(private_key_path),
            "-in",
            str(canonical_path),
            "-out",
            str(signature_bytes_path),
        ],
        check=True,
    )
    signature_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "algorithm": "ed25519",
                "keyId": "test-key",
                "manifestSha256": runner.release_manifest_sha256(manifest),
                "signedAt": "2026-06-09T00:00:00.000Z",
                "notBefore": "2026-06-09T00:00:00.000Z",
                "expiresAt": "9999-12-31T23:59:59.999Z",
                "signature": base64.b64encode(signature_bytes_path.read_bytes()).decode("ascii"),
            }
        ),
        encoding="utf-8",
    )
    calls: list[list[str]] = []

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setattr(runner, "RELEASE_EVIDENCE", {})
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SIGNATURE_URL", file_url(signature_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_TRUST_POLICY", "require_signature")
    monkeypatch.setenv(
        "THINKWORK_RELEASE_MANIFEST_TRUSTED_KEYS_JSON",
        json.dumps(
            [
                {
                    "keyId": "test-key",
                    "publicKeyPem": public_key_path.read_text(encoding="utf-8"),
                }
            ]
        ),
    )
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "1.0.0")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    runner.sync_release_artifacts()

    assert calls == [
        [
            "aws",
            "s3",
            "cp",
            str(release_dir / "lambdas/graphql-http.zip"),
            "s3://thinkwork-artifacts/releases/1.0.0/lambdas/graphql-http.zip",
        ]
    ]
    assert runner.RELEASE_EVIDENCE["trust"] == {
        "policy": "require_signature",
        "signatureRequired": True,
        "signatureVerified": True,
        "unsignedCanaryAllowed": False,
        "keyId": "test-key",
        "signatureUrl": file_url(signature_path),
    }


class FakeLedgerDb:
    """In-memory stand-in for the psql/psql_output pair: tracks the migration
    ledger and records which migration files were applied."""

    def __init__(self, tenants_exist: bool, ledger: set[str] | None = None,
                 present_objects: set[str] | None = None) -> None:
        self.tenants_exist = tenants_exist
        self.ledger: dict[str, str] = {name: "preexisting" for name in (ledger or set())}
        self.ledger_table_exists = ledger is not None
        self.present_objects = present_objects or set()
        self.applied_files: list[str] = []
        self.events: list[tuple[str, str]] = []

    def psql(self, _database_url, sql=None, file=None, variables=None):
        if file is not None:
            self.applied_files.append(Path(file).name)
            self.events.append(("apply", Path(file).name))
            return
        assert sql is not None
        if "CREATE TABLE IF NOT EXISTS public.platform_schema_migrations" in sql:
            self.ledger_table_exists = True
            self.events.append(("ensure-ledger", ""))
            return
        if "INSERT INTO public.platform_schema_migrations" in sql:
            for name, source in re.findall(r"\('([^']+)', '([^']+)'\)", sql):
                self.ledger.setdefault(name, source)
                self.events.append(("record", f"{name}:{source}"))
            return
        self.events.append(("sql", sql.strip().splitlines()[0] if sql.strip() else ""))

    def psql_output(self, _database_url, sql):
        if "to_regclass('public.tenants')" in sql:
            return "public.tenants" if self.tenants_exist else ""
        if "to_regclass('public.platform_schema_migrations')" in sql:
            return "public.platform_schema_migrations" if self.ledger_table_exists else ""
        if "SELECT name FROM public.platform_schema_migrations" in sql:
            return "\n".join(sorted(self.ledger))
        for obj in self.present_objects:
            if f"'{obj}'" in sql or f"to_regclass('{obj}')" in sql:
                return "1"
        return ""


def run_push_database_schema(
    runner,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    db: FakeLedgerDb,
    migration_names: list[str],
    migration_bodies: dict[str, str] | None = None,
) -> list[tuple[str, str]]:
    source_dir = tmp_path / "source"
    outputs_path = tmp_path / "outputs.json"
    outputs_path.write_text("{}", encoding="utf-8")
    write_drizzle_files(source_dir, migration_names)
    for name, body in (migration_bodies or {}).items():
        (source_dir / "packages/database-pg/drizzle" / name).write_text(body, encoding="utf-8")

    monkeypatch.setattr(runner, "SOURCE", source_dir)
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_SOURCE", "thinkwork-ai/thinkwork/aws")
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.170")
    monkeypatch.setattr(runner, "checkout_source", lambda *_args: None)
    monkeypatch.setattr(runner, "database_url_from_outputs", lambda _outputs: "postgres://db")
    monkeypatch.setattr(runner, "psql", db.psql)
    monkeypatch.setattr(runner, "psql_output", db.psql_output)
    monkeypatch.setattr(
        runner,
        "initialize_greenfield_database",
        lambda *_args: db.events.append(("initialize", "")),
    )
    monkeypatch.setattr(
        runner,
        "seed_platform_bootstrap_defaults",
        lambda _database_url: db.events.append(("seed", "")),
    )

    runner.push_database_schema(outputs_path, {"stage": "tei-e2e"})
    return db.events


def test_push_database_schema_applies_only_unrecorded_migrations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    db = FakeLedgerDb(
        tenants_exist=True,
        ledger={
            "0149_user_model_approvals.sql",
            "0152_agent_profiles.sql",
            "0155_tenant_model_catalog.sql",
        },
    )
    run_push_database_schema(
        runner,
        tmp_path,
        monkeypatch,
        db,
        [
            "0149_user_model_approvals.sql",
            "0152_agent_profiles.sql",
            "0155_tenant_model_catalog.sql",
            "0158_pending_user_questions.sql",
        ],
    )

    assert db.applied_files == [
        "0158_pending_user_questions.sql",
        "0155_tenant_model_catalog.sql",  # post-seed backfill re-run
    ]
    assert db.ledger["0158_pending_user_questions.sql"] == "runner"
    assert ("seed", "") in db.events
    # seed runs after the pending migration and before the post-seed re-run
    assert db.events.index(("seed", "")) > db.events.index(
        ("apply", "0158_pending_user_questions.sql")
    )


def test_push_database_schema_transition_backfills_ledger_via_markers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    db = FakeLedgerDb(
        tenants_exist=True,
        ledger=None,  # no ledger table yet: pre-ledger environment
        present_objects={"public.user_model_approvals"},
    )
    run_push_database_schema(
        runner,
        tmp_path,
        monkeypatch,
        db,
        ["0001_ancient.sql", "0155_tenant_model_catalog.sql"],
        migration_bodies={
            "0149_user_model_approvals.sql": (
                "-- creates: public.user_model_approvals\nSELECT 1;\n"
            ),
            "0158_pending_user_questions.sql": (
                "-- creates: public.pending_user_questions\nCREATE TABLE IF NOT EXISTS "
                "public.pending_user_questions ();\n"
            ),
        },
    )

    # transition never re-runs existing files — markers can name objects that
    # later migrations intentionally dropped, so auto-apply is unsafe
    assert db.applied_files == ["0155_tenant_model_catalog.sql"]  # post-seed re-run only
    # marker objects present -> verified
    assert db.ledger["0149_user_model_approvals.sql"] == "transition-verified"
    # marker objects missing -> recorded as assumed, surfaced as a warning
    assert db.ledger["0158_pending_user_questions.sql"] == "transition-assumed"
    # no markers -> assumed applied
    assert db.ledger["0001_ancient.sql"] == "transition-assumed"


def test_push_database_schema_greenfield_records_full_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    db = FakeLedgerDb(tenants_exist=False)
    run_push_database_schema(
        runner,
        tmp_path,
        monkeypatch,
        db,
        ["0001_init.sql", "0155_tenant_model_catalog.sql"],
    )

    assert ("initialize", "") in db.events
    assert db.ledger == {
        "0001_init.sql": "greenfield",
        "0155_tenant_model_catalog.sql": "greenfield",
    }
    # nothing re-applies through the pending path; only the post-seed re-run
    assert db.applied_files == ["0155_tenant_model_catalog.sql"]


def test_declared_migration_objects_parses_header_markers(tmp_path: Path) -> None:
    runner = load_runner()
    path = tmp_path / "0158_pending_user_questions.sql"
    path.write_text(
        "-- Purpose: example\n"
        "-- creates: public.pending_user_questions\n"
        "-- creates: public.idx_pending_user_questions_tenant\n"
        "-- creates-column: public.computers.scope\n"
        "-- creates-constraint: public.pending_user_questions.pending_status_allowed\n"
        "\n"
        "CREATE TABLE IF NOT EXISTS public.pending_user_questions ();\n"
        "-- creates: public.after_body_ignored\n",
        encoding="utf-8",
    )

    assert runner.declared_migration_objects(path) == [
        ("object", "public.pending_user_questions"),
        ("object", "public.idx_pending_user_questions_tenant"),
        ("column", "public.computers.scope"),
        ("constraint", "public.pending_user_questions.pending_status_allowed"),
    ]


def test_build_deployment_status_pointer_success_sets_active_release() -> None:
    runner = load_runner()
    pointer = runner.build_deployment_status_pointer(
        "succeeded",
        action="update",
        release={"version": "v0.1.0-canary.170", "manifestUrl": "u", "manifestSha256": "s"},
        previous={"activeRelease": {"version": "v0.1.0-canary.165"}},
        controller={"codebuildBuildId": "b:1", "sessionId": "sess", "stateMachineArn": None},
        environment_url="https://example.cloudfront.net",
        stage="tei-e2e",
        region="us-east-1",
        account_id="123",
        started_at="t0",
        recorded_at="t1",
        terraform_exit_code=0,
        evidence_bucket="bucket",
        evidence_key="sessions/sess/update/deployment-evidence.json",
    )

    assert pointer["contract"] == "thinkwork.deployment.status.v1"
    assert pointer["activeRelease"]["version"] == "v0.1.0-canary.170"
    assert pointer["lastSuccessfulDeployment"]["sessionId"] == "sess"
    assert pointer["lastSuccessfulDeployment"]["terraformExitCode"] == 0
    assert "targetRelease" not in pointer
    assert "stateMachineArn" not in pointer["controller"]


def test_build_deployment_status_pointer_failure_preserves_active_release() -> None:
    runner = load_runner()
    previous = {
        "activeRelease": {"version": "v0.1.0-canary.165"},
        "lastSuccessfulDeployment": {"sessionId": "old"},
        "environmentUrl": "https://example.cloudfront.net",
    }
    pointer = runner.build_deployment_status_pointer(
        "failed",
        action="update",
        release={"version": "v0.1.0-canary.170", "manifestUrl": "u", "manifestSha256": "s"},
        previous=previous,
        controller={"codebuildBuildId": "b:2"},
        environment_url=None,
        stage="tei-e2e",
        region="us-east-1",
        account_id="123",
        started_at="t0",
        recorded_at="t1",
        error=RuntimeError("terraform exploded"),
    )

    assert pointer["status"] == "failed"
    assert pointer["activeRelease"]["version"] == "v0.1.0-canary.165"
    assert pointer["targetRelease"]["version"] == "v0.1.0-canary.170"
    assert pointer["lastSuccessfulDeployment"]["sessionId"] == "old"
    assert pointer["environmentUrl"] == "https://example.cloudfront.net"
    assert "terraform exploded" in pointer["error"]


def test_write_deployment_status_pointer_uploads_current_and_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(runner, "TF", tmp_path / "tf-none")
    monkeypatch.setenv("THINKWORK_EVIDENCE_BUCKET", "evidence-bucket")
    monkeypatch.setenv("THINKWORK_DEPLOYMENT_ACTION", "update")
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.170")
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", "https://example.com/m.json")
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", "abc")
    monkeypatch.setenv("THINKWORK_DEPLOYMENT_SESSION_ID", "sess-1")
    monkeypatch.setenv("THINKWORK_EVIDENCE_PREFIX", "sessions/sess-1/update")

    uploads: list[str] = []
    monkeypatch.setattr(runner, "run", lambda args, **_kw: uploads.append(args[-1]))
    monkeypatch.setattr(
        runner, "output", lambda *_args, **_kw: (_ for _ in ()).throw(RuntimeError("404"))
    )

    runner.write_deployment_status_pointer("succeeded", {"region": "us-east-1"}, 0)

    body = json.loads((tmp_path / "deployment-status-pointer.json").read_text(encoding="utf-8"))
    assert body["activeRelease"]["version"] == "v0.1.0-canary.170"
    assert body["lastSuccessfulDeployment"]["sessionId"] == "sess-1"
    assert uploads[-1] == "s3://evidence-bucket/deployment/status/current.json"
    assert any("deployment/status/history/" in target for target in uploads)


def test_write_deployment_status_pointer_skips_non_deploy_actions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("THINKWORK_EVIDENCE_BUCKET", "evidence-bucket")
    monkeypatch.setenv("THINKWORK_DEPLOYMENT_ACTION", "plan")
    uploads: list[str] = []
    monkeypatch.setattr(runner, "run", lambda args, **_kw: uploads.append(args[-1]))

    runner.write_deployment_status_pointer("succeeded", {}, 0)

    assert uploads == []


def test_payload_release_selection_overrides_stale_runner_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "thinkwork-release.json"
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    lambda_bytes = b"lambda-zip"
    write_tar(bundle_path, {"lambdas/graphql-http.zip": lambda_bytes})
    artifacts = [
        {
            "name": "graphql-http",
            "type": "lambda",
            "fileName": "graphql-http.zip",
            "relativePath": "lambdas/graphql-http.zip",
            "url": None,
            "sha256": digest(lambda_bytes),
            "sizeBytes": len(lambda_bytes),
        }
    ]
    manifest_sha = write_manifest(
        manifest_path,
        release_manifest(bundle_path, runner.sha256_file(bundle_path), artifacts),
    )
    calls: list[list[str]] = []

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setattr(runner, "RELEASE_EVIDENCE", {})
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", "https://example.test/old.json")
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", "0" * 64)
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.130")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    runner.apply_release_selection(
        {
            "release": {
                "version": "v0.1.0-canary.137",
                "manifestUrl": file_url(manifest_path),
                "manifestSha256": manifest_sha,
            }
        }
    )
    runner.sync_release_artifacts()

    assert calls == [
        [
            "aws",
            "s3",
            "cp",
            str(release_dir / "lambdas/graphql-http.zip"),
            "s3://thinkwork-artifacts/releases/v0.1.0-canary.137/lambdas/graphql-http.zip",
        ]
    ]
    assert runner.os.environ["THINKWORK_RELEASE_VERSION"] == "v0.1.0-canary.137"
    assert runner.os.environ["THINKWORK_RELEASE_MANIFEST_URL"] == file_url(manifest_path)
    assert runner.os.environ["THINKWORK_RELEASE_MANIFEST_SHA256"] == manifest_sha


def test_write_runner_files_persists_selected_release_to_controller_module(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = tmp_path / "terraform"
    old_manifest_url = "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.145/thinkwork-release.json"
    new_manifest_path = tmp_path / "new-thinkwork-release.json"
    new_manifest_git_sha = "c706fd93b917ee71a01add97ee7dc7c977cc2bb8"
    new_manifest_sha = write_manifest(
        new_manifest_path,
        {
            "schemaVersion": 1,
            "release": {
                "version": "v0.1.0-canary.146",
                "gitSha": new_manifest_git_sha,
                "createdAt": "2026-06-09T00:00:00.000Z",
            },
        },
    )
    new_manifest_url = file_url(new_manifest_path)

    monkeypatch.setattr(runner, "TF", tf_dir)
    monkeypatch.setattr(runner, "MANIFEST", tmp_path / "missing-manifest.json")
    monkeypatch.setenv("THINKWORK_STAGE", "tei-e2e")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_SOURCE", "thinkwork-ai/thinkwork/aws")
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_VERSION", "0.1.0-canary.145")
    monkeypatch.setenv("THINKWORK_TERRAFORM_STATE_BUCKET", "thinkwork-state")
    monkeypatch.setenv("THINKWORK_TERRAFORM_LOCK_TABLE", "thinkwork-locks")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.145")
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", old_manifest_url)
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", "f0a149db34d59e290fc4a43bc098a57539dcae508445e0fb626b8ce45f9eaf1c")
    monkeypatch.setenv(
        "THINKWORK_RELEASE_MANIFEST_TRUSTED_KEYS_JSON",
        '[{"keyId":"test-key","publicKeyPem":"-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----"}]',
    )

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "release": {
                "version": "v0.1.0-canary.146",
                "manifestUrl": new_manifest_url,
                "manifestSha256": new_manifest_sha,
                "manifestTrustPolicy": "allow_unsigned_canary",
            },
        },
        {},
    )

    tfvars = json.loads((tf_dir / "terraform.auto.tfvars.json").read_text(encoding="utf-8"))
    main_tf = (tf_dir / "main.tf").read_text(encoding="utf-8")

    assert vars_json["deployment_release_version"] == "v0.1.0-canary.146"
    assert vars_json["deployment_release_manifest_url"] == new_manifest_url
    assert vars_json["deployment_release_manifest_sha256"] == new_manifest_sha
    assert vars_json["deployment_release_manifest_trust_policy"] == "allow_unsigned_canary"
    assert vars_json["deployment_release_manifest_trusted_keys_json"] == (
        '[{"keyId":"test-key","publicKeyPem":"-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----"}]'
    )
    assert tfvars["deployment_release_version"] == "v0.1.0-canary.146"
    assert tfvars["deployment_release_manifest_url"] == new_manifest_url
    assert old_manifest_url not in main_tf
    assert f"ref={new_manifest_git_sha}" in main_tf
    assert "deployment_release_manifest_signature_url" in main_tf
    assert "deployment_release_manifest_trusted_keys_json" in main_tf
    assert "deployment_terraform_module_source" in main_tf


def _cognito_email_runner_env(
    runner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    tf_dir = tmp_path / "terraform"
    manifest_path = tmp_path / "thinkwork-release.json"
    manifest_sha = write_manifest(
        manifest_path,
        {
            "schemaVersion": 1,
            "release": {
                "version": "v0.1.0-canary.150",
                "gitSha": "abc123",
                "createdAt": "2026-06-09T00:00:00.000Z",
            },
            "artifactBundles": [],
            "artifacts": [],
            "runtimeImages": [],
        },
    )
    monkeypatch.setattr(runner, "TF", tf_dir)
    monkeypatch.setattr(runner, "MANIFEST", tmp_path / "missing-manifest.json")
    monkeypatch.setenv("THINKWORK_STAGE", "tei-e2e")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_SOURCE", "thinkwork-ai/thinkwork/aws")
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_VERSION", "0.1.0-canary.150")
    monkeypatch.setenv("THINKWORK_TERRAFORM_STATE_BUCKET", "thinkwork-state")
    monkeypatch.setenv("THINKWORK_TERRAFORM_LOCK_TABLE", "thinkwork-locks")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.150")
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    return tf_dir


def test_write_runner_files_threads_cognito_email_vars_from_payload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    identity_arn = "arn:aws:ses:us-east-1:637423202447:identity/lastmile-tei.com"

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "cognitoEmailSourceArn": identity_arn,
            "cognitoFromEmailAddress": "ThinkWork <noreply@lastmile-tei.com>",
            "cognitoReplyToEmailAddress": "support@lastmile-tei.com",
            "appDomain": "tw.lastmile-tei.com",
            "appCertificateArn": (
                "arn:aws:acm:us-east-1:637423202447:certificate/4c53e8c5-3f62-41db-baf8-7bd030d80499"
            ),
        },
        {},
    )

    tfvars = json.loads((tf_dir / "terraform.auto.tfvars.json").read_text(encoding="utf-8"))
    assert vars_json["cognito_email_source_arn"] == identity_arn
    assert vars_json["cognito_from_email_address"] == "ThinkWork <noreply@lastmile-tei.com>"
    assert vars_json["cognito_reply_to_email_address"] == "support@lastmile-tei.com"
    assert vars_json["app_domain"] == "tw.lastmile-tei.com"
    assert vars_json["app_certificate_arn"].endswith("4c53e8c5-3f62-41db-baf8-7bd030d80499")
    assert tfvars["cognito_email_source_arn"] == identity_arn
    assert tfvars["cognito_from_email_address"] == "ThinkWork <noreply@lastmile-tei.com>"
    assert tfvars["cognito_reply_to_email_address"] == "support@lastmile-tei.com"
    assert tfvars["app_domain"] == "tw.lastmile-tei.com"

    # A value in terraform.auto.tfvars.json that the generated root module
    # never declares is dropped by Terraform with only a warning — every
    # controller-configurable var needs all three wiring points: vars_json,
    # a root-module variable declaration, and a module argument.
    main_tf = (tf_dir / "main.tf").read_text(encoding="utf-8")
    for name in (
        "cognito_email_source_arn",
        "cognito_from_email_address",
        "cognito_reply_to_email_address",
        "app_domain",
        "app_certificate_arn",
    ):
        assert f'variable "{name}"' in main_tf
        assert f"= var.{name}" in main_tf


def test_write_runner_files_repins_stale_thinkwork_git_module_source_to_release(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    monkeypatch.setenv(
        "THINKWORK_TERRAFORM_MODULE_SOURCE",
        "git::https://github.com/thinkwork-ai/thinkwork.git"
        "//terraform/modules/thinkwork?ref=c66a3aa7f3a5606c66b920b40b39af57a7cc06d0",
    )
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_VERSION", "0.1.0-canary.150")

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
        },
        {},
    )

    main_tf = (tf_dir / "main.tf").read_text(encoding="utf-8")

    assert "ref=abc123" in main_tf
    assert "ref=c66a3aa7f3a5606c66b920b40b39af57a7cc06d0" not in main_tf
    assert vars_json["deployment_terraform_module_source"].endswith(
        "//terraform/modules/thinkwork?ref=abc123"
    )
    assert vars_json["deployment_terraform_module_version"] == ""


def test_write_runner_files_cognito_email_vars_prefer_runner_secrets_and_default_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    secret_arn = "arn:aws:ses:us-east-1:637423202447:identity/secret.example.com"

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "cognitoEmailSourceArn": "arn:aws:ses:us-east-1:637423202447:identity/payload.example.com",
        },
        {"cognitoEmailSourceArn": secret_arn},
    )
    assert vars_json["cognito_email_source_arn"] == secret_arn

    vars_json_default = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
        },
        {},
    )
    assert vars_json_default["cognito_email_source_arn"] == ""
    assert vars_json_default["cognito_from_email_address"] == ""
    assert vars_json_default["cognito_reply_to_email_address"] == ""
    assert vars_json_default["app_domain"] == ""
    assert vars_json_default["app_certificate_arn"] == ""


def test_write_runner_files_threads_customer_domain_vars_from_payload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = _cognito_email_runner_env(runner, tmp_path, monkeypatch)

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "customerDomain": "tei.thinkwork.ai",
            "customerDomainDelegated": True,
            "customerDomainLegacyRetired": False,
        },
        {},
    )

    assert vars_json["customer_domain"] == "tei.thinkwork.ai"
    assert vars_json["customer_domain_delegated"] is True
    assert vars_json["customer_domain_legacy_retired"] is False

    # Booleans must survive the tfvars round-trip as real JSON booleans —
    # the generated root declares them `type = bool` and rejects strings.
    tfvars = json.loads((tf_dir / "terraform.auto.tfvars.json").read_text(encoding="utf-8"))
    assert tfvars["customer_domain"] == "tei.thinkwork.ai"
    assert tfvars["customer_domain_delegated"] is True
    assert tfvars["customer_domain_legacy_retired"] is False

    # All four wiring points: vars_json (above), root variable declarations,
    # module arguments, and the aliased us-east-1 provider + providers mapping
    # the thinkwork module's configuration_aliases requires.
    main_tf = (tf_dir / "main.tf").read_text(encoding="utf-8")
    for name in (
        "customer_domain",
        "customer_domain_delegated",
        "customer_domain_legacy_retired",
    ):
        assert f'variable "{name}"' in main_tf
        assert f"= var.{name}" in main_tf
    assert 'variable "customer_domain_delegated" {\n  type = bool\n}' in main_tf
    assert 'variable "customer_domain_legacy_retired" {\n  type = bool\n}' in main_tf
    assert 'alias  = "us_east_1"' in main_tf
    assert 'region = "us-east-1"' in main_tf
    assert "aws.us_east_1 = aws.us_east_1" in main_tf


def test_write_runner_files_without_domain_keeps_defaults_and_provider_alias(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = _cognito_email_runner_env(runner, tmp_path, monkeypatch)

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
        },
        {},
    )

    assert vars_json["customer_domain"] == ""
    assert vars_json["customer_domain_delegated"] is False
    assert vars_json["customer_domain_legacy_retired"] is False

    tfvars = json.loads((tf_dir / "terraform.auto.tfvars.json").read_text(encoding="utf-8"))
    assert tfvars["customer_domain"] == ""
    assert tfvars["customer_domain_delegated"] is False
    assert tfvars["customer_domain_legacy_retired"] is False

    # The thinkwork module requires the us-east-1 alias unconditionally, so
    # the provider block and providers mapping must exist even without a
    # customer domain.
    main_tf = (tf_dir / "main.tf").read_text(encoding="utf-8")
    assert 'alias  = "us_east_1"' in main_tf
    assert "aws.us_east_1 = aws.us_east_1" in main_tf

    # Existing greenfield state can contain Cloudflare DNS records. Managed-app
    # targeted plans do not change those records, but Terraform still needs the
    # provider schema to refresh state.
    assert 'source  = "cloudflare/cloudflare"' in main_tf
    assert 'provider "cloudflare" {}' in main_tf


def test_terraform_backend_key_keeps_platform_state_on_root_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    monkeypatch.delenv("THINKWORK_MANAGED_APP_STATE_ISOLATION", raising=False)

    assert runner.terraform_backend_key("dev", {}) == "thinkwork/dev/terraform.tfstate"
    assert runner.terraform_workspace_name("dev", {}) == "dev"


def test_terraform_backend_key_isolates_managed_app_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    monkeypatch.setenv("THINKWORK_MANAGED_APP_STATE_ISOLATION", "true")

    payload = {"appKey": "plane", "operation": "UPGRADE"}

    assert (
        runner.terraform_backend_key("dev", payload)
        == "thinkwork/dev/managed-apps/plane/terraform.tfstate"
    )
    assert runner.terraform_workspace_name("dev", payload) == "default"


def test_write_runner_files_keeps_managed_apps_on_root_backend_until_migration_enabled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    monkeypatch.delenv("THINKWORK_MANAGED_APP_STATE_ISOLATION", raising=False)

    runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "appKey": "plane",
            "operation": "DESTROY",
        },
        {},
    )

    backend = (tf_dir / "backend.hcl").read_text(encoding="utf-8")
    assert 'key = "thinkwork/tei-e2e/terraform.tfstate"' in backend
    assert "managed-apps/plane" not in backend


def test_write_runner_files_can_target_per_app_backend_after_state_migration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = _cognito_email_runner_env(runner, tmp_path, monkeypatch)

    runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "appKey": "plane",
            "operation": "DESTROY",
            "features": {"managedAppStateIsolation": True},
        },
        {},
    )

    backend = (tf_dir / "backend.hcl").read_text(encoding="utf-8")
    assert 'key = "thinkwork/tei-e2e/managed-apps/plane/terraform.tfstate"' in backend


def test_plane_managed_app_runner_writes_dns_record_and_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    tf_dir = _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    monkeypatch.setattr(
        runner,
        "current_terraform_state",
        lambda _stage: {
            "outputs": {
                "deployment_control_plane_enabled": {"value": True},
                "plane_provisioned": {"value": False},
                "plane_runtime_enabled": {"value": False},
            },
            "resources": [
                {
                    "type": "cloudflare_record",
                    "name": "app",
                    "instances": [{"attributes": {"zone_id": "zone_123"}}],
                }
            ],
        },
    )

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "appKey": "plane",
            "operation": "UPGRADE",
            "desiredConfig": {
                "dbUrlSecretArn": "arn:aws:secretsmanager:us-east-1:637423202447:secret:plane-db",
                "secretKeySecretArn": "arn:aws:secretsmanager:us-east-1:637423202447:secret:plane-secret",
                "liveServerSecretKeySecretArn": "arn:aws:secretsmanager:us-east-1:637423202447:secret:plane-live",
                "aesSecretKeySecretArn": "arn:aws:secretsmanager:us-east-1:637423202447:secret:plane-aes",
                "domain": "plane.thinkwork.ai",
                "publicUrl": "https://plane.thinkwork.ai",
                "certificateArn": "arn:aws:acm:us-east-1:637423202447:certificate/test",
                "s3BucketName": "thinkwork-dev-637423202447-plane",
            },
            "manifestImages": {
                "plane-aio": (
                    "artifacts.plane.so/makeplane/plane-aio-commercial:stable@sha256:"
                    "7385b873e58f8325e68950689ae003ce1cb8d017f49011ab4b3f1ad9e6e958db"
                ),
                "plane-mcp": (
                    "ghcr.io/thinkwork-ai/plane-mcp:0.1.0@sha256:"
                    "1111111111111111111111111111111111111111111111111111111111111111"
                ),
            },
        },
        {},
    )

    tfvars = json.loads((tf_dir / "terraform.auto.tfvars.json").read_text(encoding="utf-8"))
    main_tf = (tf_dir / "main.tf").read_text(encoding="utf-8")

    assert vars_json["cloudflare_zone_id"] == "zone_123"
    assert vars_json["plane_dns_name"] == "plane.thinkwork.ai"
    assert vars_json["plane_dns_enabled"] is True
    assert tfvars["cloudflare_zone_id"] == "zone_123"
    assert tfvars["plane_dns_enabled"] is True
    assert "plane_amqp_url_secret_arn" not in tfvars
    assert 'resource "cloudflare_record" "plane"' in main_tf
    assert "content = module.thinkwork.plane_alb_dns_name" in main_tf
    assert 'variable "n8n_provisioned"' in main_tf
    assert "n8n_provisioned                  = var.n8n_provisioned" in main_tf
    assert 'output "n8n_url"' in main_tf
    assert 'variable "plane_amqp_url_secret_arn"' not in main_tf
    assert "plane_amqp_url_secret_arn" not in main_tf
    assert "-target=cloudflare_record.plane" in runner.managed_app_terraform_target_args(
        {"appKey": "plane"}
    )
    assert "-target=module.thinkwork.module.n8n" in runner.managed_app_terraform_target_args(
        {"appKey": "n8n"}
    )


def test_n8n_managed_app_overrides_complete_sparse_live_install_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    n8n_image_uri = (
        "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork/n8n"
        "@sha256:"
        "3333333333333333333333333333333333333333333333333333333333333333"
    )
    monkeypatch.setattr(
        runner,
        "release_runtime_image",
        lambda name: n8n_image_uri if name == "n8n-runtime" else "",
    )
    state = {
        "resources": [
            {
                "type": "terraform_data",
                "name": "twenty_configuration_guardrails",
                "instances": [
                    {
                        "attributes": {
                            "input": {
                                "value": {
                                    "twenty_public_url": "https://crm.thinkwork.ai",
                                    "twenty_certificate_arn": (
                                        "arn:aws:acm:us-east-1:"
                                        "487219502366:certificate/www"
                                    ),
                                }
                            }
                        }
                    }
                ],
            },
            {
                "type": "terraform_data",
                "name": "plane_configuration_guardrails",
                "instances": [
                    {
                        "attributes": {
                            "input": {
                                "value": {
                                    "plane_runtime_enabled": True,
                                    "plane_image_uri": (
                                        "artifacts.plane.so/makeplane/"
                                        "plane-aio-commercial:stable@sha256:"
                                        "7385b873e58f8325e68950689ae003ce1cb8d017"
                                        "f49011ab4b3f1ad9e6e958db"
                                    ),
                                    "plane_mcp_image_uri": (
                                        "ghcr.io/thinkwork-ai/plane-mcp:0.1.0@sha256:"
                                        "111111111111111111111111111111111111111111"
                                        "1111111111111111111111"
                                    ),
                                    "plane_db_url_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-db"
                                    ),
                                    "plane_secret_key_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-secret"
                                    ),
                                    "plane_live_server_secret_key_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-live"
                                    ),
                                    "plane_aes_secret_key_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-aes"
                                    ),
                                    "plane_s3_bucket_name": "thinkwork-dev-plane",
                                    "plane_public_url": "https://plane.thinkwork.ai",
                                    "plane_certificate_arn": (
                                        "arn:aws:acm:us-east-1:"
                                        "487219502366:certificate/www"
                                    ),
                                }
                            }
                        }
                    }
                ],
            },
        ]
    }

    overrides = runner.managed_app_terraform_overrides(
        {
            "appKey": "n8n",
            "operation": "ENABLE",
            "desiredConfig": {
                "databaseName": "thinkwork_n8n",
                "storagePrefix": "managed-apps/n8n",
                "mainDesiredCount": 1,
                "workerDesiredCount": 1,
            },
        },
        "dev",
        "487219502366",
        {
            "db_secret_arn": {
                "value": (
                    "arn:aws:secretsmanager:us-east-1:"
                    "487219502366:secret:thinkwork-dev-db-credentials"
                )
            },
            "n8n_provisioned": {"value": False},
            "n8n_runtime_enabled": {"value": False},
            "plane_provisioned": {"value": True},
            "plane_runtime_enabled": {"value": True},
        },
        state,
    )

    assert overrides["n8n_provisioned"] is True
    assert overrides["n8n_runtime_enabled"] is True
    assert overrides["n8n_image_uri"] == n8n_image_uri
    assert overrides["n8n_database_admin_secret_arn"].endswith(
        ":secret:thinkwork-dev-db-credentials"
    )
    assert overrides["n8n_database_url_secret_arn"] == ""
    assert overrides["n8n_encryption_key_secret_arn"] == ""
    assert overrides["n8n_operator_secret_arn"] == ""
    assert overrides["n8n_service_credential_secret_arn"] == ""
    assert overrides["deployment_control_plane_create_secret_placeholders"] is True
    assert overrides["n8n_public_url"] == "https://n8n.thinkwork.ai"
    assert overrides["n8n_domain"] == "n8n.thinkwork.ai"
    assert overrides["n8n_certificate_arn"].endswith(":certificate/www")
    assert overrides["n8n_storage_bucket_name"] == "thinkwork-dev-487219502366-n8n"
    assert overrides["n8n_storage_prefix"] == "managed-apps/n8n"
    assert overrides["n8n_custom_package_specs"] == []
    assert overrides["plane_provisioned"] is True
    assert overrides["plane_runtime_enabled"] is True


def test_n8n_managed_app_overrides_preserve_existing_plane_guardrails() -> None:
    runner = load_runner()
    package_config = runner.normalize_n8n_package_config(
        {"customPackageSpecs": ["zod@3.25.76", "luxon@3.7.2"]}
    )
    state = {
        "resources": [
            {
                "type": "terraform_data",
                "name": "plane_configuration_guardrails",
                "instances": [
                    {
                        "attributes": {
                            "input": {
                                "value": {
                                    "plane_runtime_enabled": True,
                                    "plane_image_uri": (
                                        "artifacts.plane.so/makeplane/plane-aio-commercial:"
                                        "stable@sha256:"
                                        "7385b873e58f8325e68950689ae003ce1cb8d017"
                                        "f49011ab4b3f1ad9e6e958db"
                                    ),
                                    "plane_mcp_image_uri": (
                                        "ghcr.io/thinkwork-ai/plane-mcp:0.1.0@sha256:"
                                        "111111111111111111111111111111111111111111"
                                        "1111111111111111111111"
                                    ),
                                    "plane_db_url_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-db"
                                    ),
                                    "plane_secret_key_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-secret"
                                    ),
                                    "plane_live_server_secret_key_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-live"
                                    ),
                                    "plane_aes_secret_key_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:plane-aes"
                                    ),
                                    "plane_s3_bucket_name": "thinkwork-dev-plane",
                                    "plane_public_url": "https://plane.thinkwork.ai",
                                    "plane_certificate_arn": (
                                        "arn:aws:acm:us-east-1:"
                                        "487219502366:certificate/plane"
                                    ),
                                    "plane_web_container_port": 8080,
                                }
                            }
                        }
                    }
                ],
            }
        ]
    }

    overrides = runner.managed_app_terraform_overrides(
        {
            "appKey": "n8n",
            "operation": "ENABLE",
            "desiredConfig": {
                "imageUri": (
                    "public.ecr.aws/thinkwork/n8n@sha256:"
                    "3333333333333333333333333333333333333333333333333333333333333333"
                ),
                "packageImageUri": (
                    "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork/n8n"
                    "@sha256:"
                    "4444444444444444444444444444444444444444444444444444444444444444"
                ),
                "customPackageSpecs": ["zod@3.25.76", "luxon@3.7.2"],
                "packageConfigDigest": package_config["digest"],
                "packageImageConfigDigest": package_config["digest"],
                "databaseAdminSecretArn": (
                    "arn:aws:secretsmanager:us-east-1:487219502366:secret:n8n-db-admin"
                ),
                "databaseUrlSecretArn": (
                    "arn:aws:secretsmanager:us-east-1:487219502366:secret:n8n-db-url"
                ),
                "databaseName": "thinkwork_n8n",
                "encryptionKeySecretArn": (
                    "arn:aws:secretsmanager:us-east-1:487219502366:secret:n8n-key"
                ),
                "operatorSecretArn": (
                    "arn:aws:secretsmanager:us-east-1:487219502366:secret:n8n-operator"
                ),
                "serviceCredentialSecretArn": (
                    "arn:aws:secretsmanager:us-east-1:487219502366:secret:n8n-service"
                ),
                "storageBucketName": "thinkwork-dev-n8n",
                "storagePrefix": "managed-apps/n8n",
                "publicUrl": "https://n8n.thinkwork.ai",
                "certificateArn": (
                    "arn:aws:acm:us-east-1:487219502366:certificate/n8n"
                ),
            },
        },
        "dev",
        "487219502366",
        {
            "plane_provisioned": {"value": True},
            "plane_runtime_enabled": {"value": True},
            "n8n_provisioned": {"value": False},
            "n8n_runtime_enabled": {"value": False},
        },
        state,
    )

    assert overrides["n8n_provisioned"] is True
    assert overrides["n8n_runtime_enabled"] is True
    assert overrides["n8n_database_name"] == "thinkwork_n8n"
    assert overrides["n8n_storage_prefix"] == "managed-apps/n8n"
    assert overrides["n8n_image_uri"].endswith("@" + "sha256:" + "4" * 64)
    assert overrides["n8n_custom_package_specs"] == ["luxon@3.7.2", "zod@3.25.76"]
    assert overrides["n8n_package_config_digest"] == package_config["digest"]
    assert overrides["plane_provisioned"] is True
    assert overrides["plane_runtime_enabled"] is True
    assert overrides["plane_image_uri"]
    assert overrides["plane_mcp_image_uri"]
    assert overrides["plane_secret_key_secret_arn"]
    assert overrides["plane_live_server_secret_key_secret_arn"]
    assert overrides["plane_aes_secret_key_secret_arn"]
    assert overrides["plane_s3_bucket_name"] == "thinkwork-dev-plane"
    assert overrides["plane_public_url"] == "https://plane.thinkwork.ai"
    assert overrides["plane_certificate_arn"].endswith(":certificate/plane")


def test_unrelated_managed_app_overrides_preserve_existing_n8n_guardrails() -> None:
    runner = load_runner()
    state = {
        "resources": [
            {
                "type": "terraform_data",
                "name": "n8n_configuration_guardrails",
                "instances": [
                    {
                        "attributes": {
                            "input": {
                                "value": {
                                    "n8n_runtime_enabled": True,
                                    "n8n_image_uri": (
                                        "487219502366.dkr.ecr.us-east-1.amazonaws.com/"
                                        "thinkwork/n8n@sha256:"
                                        "444444444444444444444444444444444444444444"
                                        "4444444444444444444444"
                                    ),
                                    "n8n_database_name": "thinkwork_n8n",
                                    "n8n_database_username": "thinkwork_n8n",
                                    "n8n_database_admin_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:n8n-db-admin"
                                    ),
                                    "n8n_database_url_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:n8n-db-url"
                                    ),
                                    "n8n_encryption_key_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:n8n-key"
                                    ),
                                    "n8n_operator_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:n8n-operator"
                                    ),
                                    "n8n_service_credential_secret_arn": (
                                        "arn:aws:secretsmanager:us-east-1:"
                                        "487219502366:secret:n8n-service"
                                    ),
                                    "n8n_storage_bucket_name": "thinkwork-dev-n8n",
                                    "n8n_storage_prefix": "managed-apps/n8n",
                                    "n8n_public_url": "https://n8n.thinkwork.ai",
                                    "n8n_certificate_arn": (
                                        "arn:aws:acm:us-east-1:"
                                        "487219502366:certificate/n8n"
                                    ),
                                    "n8n_main_desired_count": 2,
                                    "n8n_worker_desired_count": 3,
                                    "n8n_package_config_digest": "abc123",
                                    "n8n_custom_package_specs": ["luxon@3.7.2"],
                                }
                            }
                        }
                    }
                ],
            }
        ]
    }

    overrides = runner.managed_app_terraform_overrides(
        {"appKey": "twenty", "operation": "UPGRADE"},
        "dev",
        "487219502366",
        {
            "n8n_provisioned": {"value": True},
            "n8n_runtime_enabled": {"value": True},
        },
        state,
    )

    assert overrides["n8n_provisioned"] is True
    assert overrides["n8n_runtime_enabled"] is True
    assert overrides["n8n_image_uri"].endswith("@" + "sha256:" + "4" * 64)
    assert overrides["n8n_database_name"] == "thinkwork_n8n"
    assert overrides["n8n_public_url"] == "https://n8n.thinkwork.ai"
    assert overrides["n8n_main_desired_count"] == 2
    assert overrides["n8n_worker_desired_count"] == 3
    assert overrides["n8n_package_config_digest"] == "abc123"
    assert overrides["n8n_custom_package_specs"] == ["luxon@3.7.2"]


def test_managed_app_success_refreshes_root_outputs(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = load_runner()
    calls: list[list[str]] = []
    monkeypatch.setattr(runner, "TERRAFORM_EVIDENCE", {})
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    runner.refresh_outputs_after_targeted_apply({"appKey": "plane"})
    runner.refresh_outputs_after_targeted_apply({})

    assert calls == [
        [
            "terraform",
            "apply",
            "-refresh-only",
            "-auto-approve",
            "-no-color",
        ]
    ]
    assert runner.TERRAFORM_EVIDENCE["outputRefresh"] == {
        "status": "succeeded",
        "command": [
            "terraform",
            "apply",
            "-refresh-only",
            "-auto-approve",
            "-no-color",
        ],
    }


def test_managed_app_output_refresh_failure_is_non_fatal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    monkeypatch.setattr(runner, "TERRAFORM_EVIDENCE", {})

    def fail_refresh(args, **_kwargs):
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(runner, "run", fail_refresh)

    result = runner.refresh_outputs_after_targeted_apply({"appKey": "n8n"})

    assert result["status"] == "failed"
    assert result["nonFatal"] is True
    assert runner.TERRAFORM_EVIDENCE["outputRefresh"]["exitCode"] == 1


def test_managed_app_outputs_fall_back_to_state_after_output_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    outputs_path = tmp_path / "outputs.json"
    monkeypatch.setattr(runner, "TERRAFORM_EVIDENCE", {})
    monkeypatch.setattr(runner, "refresh_outputs_after_targeted_apply", lambda _payload: None)
    monkeypatch.setattr(
        runner,
        "output",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            subprocess.CalledProcessError(1, ["terraform", "output", "-json"])
        ),
    )
    monkeypatch.setattr(
        runner,
        "current_terraform_outputs",
        lambda stage: {
            "app_url": {"value": f"https://{stage}.thinkwork.ai", "type": "string"},
        },
    )
    monkeypatch.setattr(
        runner,
        "upload_evidence_artifact",
        lambda path, name=None: f"s3://evidence/{name or Path(path).name}",
    )

    runner.write_outputs_after_apply({"appKey": "n8n"}, {"stage": "dev"}, outputs_path)

    assert json.loads(outputs_path.read_text(encoding="utf-8")) == {
        "app_url": {"value": "https://dev.thinkwork.ai", "type": "string"}
    }
    assert runner.TERRAFORM_EVIDENCE["outputs"]["source"] == "state"
    assert runner.TERRAFORM_EVIDENCE["outputReadFallback"]["status"] == "succeeded"


def test_managed_app_overrides_reject_missing_operation() -> None:
    runner = load_runner()

    with pytest.raises(RuntimeError, match="operation to be one of"):
        runner.managed_app_terraform_overrides(
            {"appKey": "plane"},
            "dev",
            "487219502366",
            {},
            {"resources": []},
        )


def test_plane_managed_app_overrides_reject_missing_required_desired_state() -> None:
    runner = load_runner()

    with pytest.raises(RuntimeError, match="mcpImageUri"):
        runner.managed_app_terraform_overrides(
            {
                "appKey": "plane",
                "operation": "UPGRADE",
                "desiredConfig": {
                    "publicUrl": "https://plane.thinkwork.ai",
                    "certificateArn": "arn:aws:acm:us-east-1:637423202447:certificate/test",
                },
            },
            "dev",
            "487219502366",
            {},
            {"resources": []},
        )


def test_validate_managed_app_plan_scope_allows_plane_dns_record() -> None:
    runner = load_runner()

    runner.validate_managed_app_plan_scope(
        {"appKey": "plane"},
        {
            "resource_changes": [
                {
                    "address": "cloudflare_record.plane[0]",
                    "change": {"actions": ["create"]},
                }
            ]
        },
    )


def test_validate_managed_app_plan_scope_rejects_other_dns_records() -> None:
    runner = load_runner()

    with pytest.raises(RuntimeError, match="cloudflare_record.app"):
        runner.validate_managed_app_plan_scope(
            {"appKey": "plane"},
            {
                "resource_changes": [
                    {
                        "address": "cloudflare_record.app[0]",
                        "change": {"actions": ["create"]},
                    }
                ]
            },
        )


def test_validate_environment_plan_scope_rejects_customer_domain_deletes() -> None:
    runner = load_runner()

    with pytest.raises(RuntimeError, match="customer-domain web resources"):
        runner.validate_environment_plan_scope(
            {},
            {
                "resource_changes": [
                    {
                        "address": (
                            "module.thinkwork.module.customer_domain."
                            "aws_route53_record.app_alias_a[0]"
                        ),
                        "change": {"actions": ["delete"]},
                    }
                ]
            },
        )


def test_validate_environment_plan_scope_allows_reviewed_domain_removal() -> None:
    runner = load_runner()

    runner.validate_environment_plan_scope(
        {"allowCustomerDomainRemoval": True},
        {
            "resource_changes": [
                {
                    "address": (
                        "module.thinkwork.module.customer_domain."
                        "aws_route53_record.app_alias_a[0]"
                    ),
                    "change": {"actions": ["delete"]},
                }
            ]
        },
    )


def test_validate_environment_plan_scope_rejects_cloudfront_alias_removal() -> None:
    runner = load_runner()

    with pytest.raises(RuntimeError, match="customer-domain web resources"):
        runner.validate_environment_plan_scope(
            {},
            {
                "resource_changes": [
                    {
                        "address": (
                            "module.thinkwork.module.computer_site."
                            "aws_cloudfront_distribution.site"
                        ),
                        "change": {
                            "actions": ["update"],
                            "before": {"aliases": ["tei.thinkwork.ai"]},
                            "after": {"aliases": []},
                        },
                    }
                ]
            },
        )


def test_configure_cloudflare_provider_auth_reads_stage_ssm_without_tfvars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    calls: list[list[str]] = []
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)

    def fake_output(args: list[str], **_kwargs) -> str:
        calls.append(args)
        return "cf-token"

    monkeypatch.setattr(runner, "output", fake_output)

    runner.configure_cloudflare_provider_auth("dev")

    assert os.environ["CLOUDFLARE_API_TOKEN"] == "cf-token"
    assert calls == [
        [
            "aws",
            "ssm",
            "get-parameter",
            "--name",
            "/thinkwork/dev/cloudflare-namespace-token",
            "--with-decryption",
            "--query",
            "Parameter.Value",
            "--output",
            "text",
        ]
    ]


def test_cloudflare_zone_id_for_hostname_matches_longest_suffix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    monkeypatch.setattr(runner, "cloudflare_api_token", lambda _stage: "cf-token")

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "result": [
                        {"name": "thinkwork.ai", "id": "zone-thinkwork"},
                        {"name": "agents.thinkwork.ai", "id": "zone-agents"},
                    ]
                }
            ).encode()

    def fake_urlopen(request, timeout: int):
        assert timeout == 30
        assert request.headers["Authorization"] == "Bearer cf-token"
        return FakeResponse()

    monkeypatch.setattr(runner.urllib.request, "urlopen", fake_urlopen)

    assert (
        runner.cloudflare_zone_id_for_hostname("dev", "plane.agents.thinkwork.ai")
        == "zone-agents"
    )


def test_plane_overrides_derive_cloudflare_zone_when_state_lacks_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    monkeypatch.setattr(
        runner,
        "cloudflare_zone_id_for_hostname",
        lambda _stage, hostname: "zone-derived"
        if hostname == "plane.thinkwork.ai"
        else "",
    )

    overrides = runner.managed_app_terraform_overrides(
        {
            "appKey": "plane",
            "operation": "UPGRADE",
            "desiredConfig": {
                "mcpImageUri": (
                    "ghcr.io/thinkwork-ai/plane-mcp:0.1.0@sha256:"
                    "1111111111111111111111111111111111111111111111111111111111111111"
                ),
                "dbUrlSecretArn": "arn:aws:secretsmanager:us-east-1:487219502366:secret:plane-db",
                "secretKeySecretArn": "arn:aws:secretsmanager:us-east-1:487219502366:secret:plane-secret",
                "liveServerSecretKeySecretArn": "arn:aws:secretsmanager:us-east-1:487219502366:secret:plane-live",
                "aesSecretKeySecretArn": "arn:aws:secretsmanager:us-east-1:487219502366:secret:plane-aes",
                "domain": "plane.thinkwork.ai",
                "publicUrl": "https://plane.thinkwork.ai",
                "certificateArn": "arn:aws:acm:us-east-1:487219502366:certificate/test",
            },
        },
        "dev",
        "487219502366",
        {"deployment_control_plane_enabled": {"value": True}},
        {"resources": []},
    )

    assert overrides["cloudflare_zone_id"] == "zone-derived"
    assert overrides["plane_dns_name"] == "plane.thinkwork.ai"
    assert overrides["plane_dns_enabled"] is True


def test_configure_terraform_provider_mirror_seeds_cloudflare_for_codebuild(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    provider_zip = b"cloudflare-provider"
    provider_digest = digest(provider_zip)

    monkeypatch.setattr(runner, "WORK", tmp_path)
    monkeypatch.setattr(runner.platform, "system", lambda: "Linux")
    monkeypatch.setattr(runner.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(runner, "CLOUDFLARE_PROVIDER_LINUX_AMD64_SHA256", provider_digest)
    monkeypatch.delenv("TF_CLI_CONFIG_FILE", raising=False)

    def fake_download(url: str, destination: Path) -> None:
        assert "terraform-provider-cloudflare_4.52.7_linux_amd64.zip" in url
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(provider_zip)

    monkeypatch.setattr(runner, "download", fake_download)

    runner.configure_terraform_provider_mirror()

    package = (
        tmp_path
        / "provider-mirror"
        / "registry.terraform.io"
        / "cloudflare"
        / "cloudflare"
        / "terraform-provider-cloudflare_4.52.7_linux_amd64.zip"
    )
    assert package.read_bytes() == provider_zip

    terraformrc = tmp_path / "terraformrc"
    contents = terraformrc.read_text(encoding="utf-8")
    assert 'include = ["registry.terraform.io/cloudflare/cloudflare"]' in contents
    assert 'exclude = ["registry.terraform.io/cloudflare/cloudflare"]' in contents
    assert os.environ["TF_CLI_CONFIG_FILE"] == str(terraformrc)


def test_write_runner_files_customer_domain_prefers_secrets_and_coerces_booleans(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    _cognito_email_runner_env(runner, tmp_path, monkeypatch)

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "customerDomain": "payload.thinkwork.ai",
            "customerDomainDelegated": False,
            "customerDomainLegacyRetired": True,
        },
        {
            "customerDomain": "secret.thinkwork.ai",
            # Secrets Manager JSON values arrive as strings; they must land
            # in vars_json as real booleans.
            "customerDomainDelegated": "true",
            "customerDomainLegacyRetired": "false",
        },
    )

    assert vars_json["customer_domain"] == "secret.thinkwork.ai"
    assert vars_json["customer_domain_delegated"] is True
    assert vars_json["customer_domain_legacy_retired"] is False


def test_write_runner_files_preserves_existing_customer_domain_from_state_outputs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    monkeypatch.setattr(
        runner,
        "current_terraform_state",
        lambda _stage: {
            "outputs": {
                "customer_domain": {"value": "tei.thinkwork.ai"},
                "customer_domain_delegated": {"value": True},
                "customer_domain_legacy_retired": {"value": False},
            }
        },
    )

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
        },
        {},
    )

    assert vars_json["customer_domain"] == "tei.thinkwork.ai"
    assert vars_json["customer_domain_delegated"] is True
    assert vars_json["customer_domain_legacy_retired"] is False


def test_write_runner_files_refuses_to_disable_existing_customer_domain_delegation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    monkeypatch.setattr(
        runner,
        "current_terraform_state",
        lambda _stage: {
            "outputs": {
                "customer_domain": {"value": "tei.thinkwork.ai"},
                "customer_domain_delegated": {"value": True},
            }
        },
    )

    with pytest.raises(RuntimeError, match="Refusing to turn off customer_domain_delegated"):
        runner.write_runner_files(
            {
                "stage": "tei-e2e",
                "awsRegion": "us-east-1",
                "awsAccountId": "637423202447",
                "dbPassword": "db-secret",
                "apiAuthSecret": "api-secret",
                "customerDomain": "tei.thinkwork.ai",
                "customerDomainDelegated": False,
            },
            {},
        )


def test_write_runner_files_preserves_existing_customer_domain_from_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    monkeypatch.setattr(
        runner,
        "current_terraform_state",
        lambda _stage: {
            "outputs": {
                "customer_domain": {"value": "tei.thinkwork.ai"},
                "customer_domain_delegated": {"value": True},
            }
        },
    )

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
        },
        {
            "customerDomain": "tei.thinkwork.ai",
            "customerDomainDelegated": "true",
            "customerDomainLegacyRetired": "false",
        },
    )

    assert vars_json["customer_domain"] == "tei.thinkwork.ai"
    assert vars_json["customer_domain_delegated"] is True
    assert vars_json["customer_domain_legacy_retired"] is False


def test_write_runner_files_requires_explicit_override_to_change_customer_domain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    _cognito_email_runner_env(runner, tmp_path, monkeypatch)
    monkeypatch.setattr(
        runner,
        "current_terraform_state",
        lambda _stage: {
            "outputs": {
                "customer_domain": {"value": "tei.thinkwork.ai"},
                "customer_domain_delegated": {"value": True},
            }
        },
    )

    with pytest.raises(RuntimeError, match="Refusing to change customer_domain"):
        runner.write_runner_files(
            {
                "stage": "tei-e2e",
                "awsRegion": "us-east-1",
                "awsAccountId": "637423202447",
                "dbPassword": "db-secret",
                "apiAuthSecret": "api-secret",
                "customerDomain": "mcpherson.thinkwork.ai",
                "customerDomainDelegated": True,
            },
            {},
        )

    vars_json = runner.write_runner_files(
        {
            "stage": "tei-e2e",
            "awsRegion": "us-east-1",
            "awsAccountId": "637423202447",
            "dbPassword": "db-secret",
            "apiAuthSecret": "api-secret",
            "customerDomain": "mcpherson.thinkwork.ai",
            "customerDomainDelegated": True,
            "allowCustomerDomainRemoval": True,
        },
        {},
    )

    assert vars_json["customer_domain"] == "mcpherson.thinkwork.ai"


def test_write_evidence_records_consumed_domain_fields(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("THINKWORK_EVIDENCE_BUCKET", raising=False)
    monkeypatch.delenv("THINKWORK_EVIDENCE_PREFIX", raising=False)
    monkeypatch.delenv("THINKWORK_DEPLOYMENT_ACTION", raising=False)

    runner.write_evidence(
        "succeeded",
        {
            "stage": "tei-e2e",
            "account_id": "637423202447",
            "region": "us-east-1",
            "customer_domain": "tei.thinkwork.ai",
            "customer_domain_delegated": True,
            "customer_domain_legacy_retired": False,
        },
        0,
    )

    evidence = json.loads((tmp_path / "deployment-evidence.json").read_text(encoding="utf-8"))
    assert evidence["consumedDomainFields"] == {
        "customerDomain": "tei.thinkwork.ai",
        "customerDomainDelegated": True,
        "customerDomainLegacyRetired": False,
    }
    assert evidence["consumedDomainFields"]["customerDomainDelegated"] is True
    assert evidence["consumedDomainFields"]["customerDomainLegacyRetired"] is False


def test_write_evidence_omits_consumed_domain_fields_without_domain_vars(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("THINKWORK_EVIDENCE_BUCKET", raising=False)
    monkeypatch.delenv("THINKWORK_EVIDENCE_PREFIX", raising=False)
    monkeypatch.delenv("THINKWORK_DEPLOYMENT_ACTION", raising=False)

    # The status action builds a minimal vars_json without domain keys — an
    # old-runner-shaped evidence document must stay distinguishable from a
    # new runner that consumed an empty domain.
    runner.write_evidence(
        "succeeded",
        {
            "stage": "tei-e2e",
            "account_id": "637423202447",
            "region": "us-east-1",
        },
        0,
    )

    evidence = json.loads((tmp_path / "deployment-evidence.json").read_text(encoding="utf-8"))
    assert "consumedDomainFields" not in evidence


def test_registry_module_source_checks_out_release_manifest_sha(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    manifest_path = tmp_path / "thinkwork-release.json"
    manifest = {
        "schemaVersion": 1,
        "release": {
            "version": "0.1.0-canary.137",
            "gitSha": "f9ebf20d2e4d592df44e66252d6c7894746689c9",
            "createdAt": "2026-06-09T19:33:51.126Z",
        },
        "artifacts": [],
        "runtimeImages": [],
    }
    write_manifest(manifest_path, manifest)

    monkeypatch.setattr(runner, "MANIFEST", manifest_path)

    assert runner.source_repo_and_ref(
        "thinkwork-ai/thinkwork/aws",
        "v0.1.0-canary.137",
    ) == (
        "https://github.com/thinkwork-ai/thinkwork.git",
        "f9ebf20d2e4d592df44e66252d6c7894746689c9",
    )


def test_registry_module_source_writes_pinned_git_module_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    manifest_path = tmp_path / "thinkwork-release.json"
    manifest = {
        "schemaVersion": 1,
        "release": {
            "version": "0.1.0-canary.140",
            "gitSha": "c706fd93b917ee71a01add97ee7dc7c977cc2bb8",
            "createdAt": "2026-06-09T22:07:19.000Z",
        },
        "artifacts": [],
        "runtimeImages": [],
    }
    write_manifest(manifest_path, manifest)

    monkeypatch.setattr(runner, "MANIFEST", manifest_path)

    assert runner.terraform_module_source_and_version(
        "thinkwork-ai/thinkwork/aws",
        "0.1.0-canary.140",
        "v0.1.0-canary.140",
    ) == (
        "git::https://github.com/thinkwork-ai/thinkwork.git"
        "//terraform/modules/thinkwork?ref=c706fd93b917ee71a01add97ee7dc7c977cc2bb8",
        "",
    )


def test_github_module_source_checks_out_https_repo() -> None:
    runner = load_runner()

    assert runner.source_repo_and_ref(
        "github.com/thinkwork-ai/thinkwork//terraform/modules/thinkwork?ref=abc123",
        "main",
    ) == ("https://github.com/thinkwork-ai/thinkwork.git", "abc123")


def test_git_module_source_ignores_registry_version() -> None:
    runner = load_runner()

    assert runner.terraform_module_source_and_version(
        "git::https://github.com/thinkwork-ai/thinkwork.git"
        "//terraform/modules/thinkwork?ref=codex/thnk-27-plane-deploy-fix",
        "0.1.0-canary.189",
        "v0.1.0-canary.189",
    ) == (
        "git::https://github.com/thinkwork-ai/thinkwork.git"
        "//terraform/modules/thinkwork?ref=codex/thnk-27-plane-deploy-fix",
        "",
    )


def test_safe_extract_rejects_archive_path_traversal(tmp_path: Path) -> None:
    runner = load_runner()
    archive_path = tmp_path / "evil.tar.gz"
    with tarfile.open(archive_path, "w:gz") as tar:
        info = tarfile.TarInfo("../evil.txt")
        data = b"nope"
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))

    with pytest.raises(RuntimeError, match="escapes destination"):
        runner.safe_extract_tar_file(archive_path, tmp_path / "extract")


def test_safe_extract_rejects_archive_links(tmp_path: Path) -> None:
    runner = load_runner()
    archive_path = tmp_path / "link.tar.gz"
    with tarfile.open(archive_path, "w:gz") as tar:
        info = tarfile.TarInfo("static/web.tar.gz")
        info.type = tarfile.SYMTYPE
        info.linkname = "/etc/passwd"
        tar.addfile(info)

    with pytest.raises(RuntimeError, match="links are not allowed"):
        runner.safe_extract_tar_file(archive_path, tmp_path / "extract")


def test_sync_release_artifacts_blocks_missing_bundle_before_staging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "thinkwork-release.json"
    lambda_bytes = b"lambda-zip"
    manifest = {
        "schemaVersion": 1,
        "release": {
            "version": "0.1.0-canary.134",
            "gitSha": "abc123",
            "createdAt": "2026-06-09T00:00:00.000Z",
        },
        "artifacts": [
            {
                "name": "graphql-http",
                "type": "lambda",
                "fileName": "graphql-http.zip",
                "relativePath": "lambdas/graphql-http.zip",
                "url": None,
                "sha256": digest(lambda_bytes),
                "sizeBytes": len(lambda_bytes),
            }
        ],
        "runtimeImages": [],
        "managedApps": [],
        "signing": {
            "acceptedKeyIds": [],
            "revokedKeyIds": [],
        },
    }
    manifest_sha = write_manifest(manifest_path, manifest)
    calls: list[list[str]] = []

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "0.1.0-canary.134")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    with pytest.raises(RuntimeError, match="not available in an artifact bundle"):
        runner.sync_release_artifacts()

    assert calls == []


def test_sync_release_artifacts_rejects_bundled_artifact_hash_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    release_dir = tmp_path / "release-work"
    manifest_path = tmp_path / "thinkwork-release.json"
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    write_tar(bundle_path, {"lambdas/graphql-http.zip": b"actual"})
    artifacts = [
        {
            "name": "graphql-http",
            "type": "lambda",
            "fileName": "graphql-http.zip",
            "relativePath": "lambdas/graphql-http.zip",
            "url": None,
            "sha256": digest(b"expected"),
            "sizeBytes": len(b"expected"),
        }
    ]
    manifest_sha = write_manifest(
        manifest_path,
        release_manifest(bundle_path, runner.sha256_file(bundle_path), artifacts),
    )

    monkeypatch.setattr(runner, "RELEASE", release_dir)
    monkeypatch.setattr(runner, "MANIFEST", release_dir / "thinkwork-release.json")
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", file_url(manifest_path))
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", manifest_sha)
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "0.1.0-canary.134")
    monkeypatch.setenv("THINKWORK_RELEASE_ARTIFACT_BUCKET", "thinkwork-artifacts")
    monkeypatch.setattr(runner, "run", lambda *_args, **_kwargs: None)

    with pytest.raises(RuntimeError, match="Artifact digest mismatch"):
        runner.sync_release_artifacts()


def test_artifact_bundle_download_path_must_stay_under_release_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    bundle_path = tmp_path / "platform-artifacts.tar.gz"
    write_tar(bundle_path, {"lambdas/graphql-http.zip": b"lambda"})

    monkeypatch.setattr(runner, "RELEASE", tmp_path / "release-work")

    with pytest.raises(RuntimeError, match="escapes destination"):
        runner.download_and_extract_artifact_bundles(
            {
                "artifactBundles": [
                    {
                        "name": "platform",
                        "fileName": "platform-artifacts.tar.gz",
                        "relativePath": "../platform-artifacts.tar.gz",
                        "url": file_url(bundle_path),
                        "sha256": runner.sha256_file(bundle_path),
                        "contains": [],
                    }
                ],
                "artifacts": [],
            }
        )


def test_materialized_artifact_path_must_stay_under_release_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    bundled_path = tmp_path / "bundle" / "graphql-http.zip"
    bundled_path.parent.mkdir(parents=True)
    bundled_path.write_bytes(b"lambda")

    monkeypatch.setattr(runner, "RELEASE", tmp_path / "release-work")

    with pytest.raises(RuntimeError, match="escapes destination"):
        runner.materialize_release_artifact(
            {
                "name": "graphql-http",
                "relativePath": "../graphql-http.zip",
                "sha256": digest(b"lambda"),
            },
            {"graphql-http": bundled_path},
        )


def test_controller_input_summary_redacts_to_deployment_contract() -> None:
    runner = load_runner()

    summary = runner.controller_input_summary(
        {
            "schemaVersion": 1,
            "contract": "thinkwork.deployment.controller.v1",
            "phase": "deploy",
            "action": "deploy",
            "sessionId": "session-1",
            "customerName": "TEI",
            "environmentName": "tei-e2e",
            "awsAccountId": "123456789012",
            "awsRegion": "us-east-1",
            "availabilityZones": ["us-east-1a", "us-east-1b"],
            "firstAdmin": {
                "name": "Eric Odom",
                "email": "eric@example.com",
                "password": "do-not-record",
            },
            "release": {
                "version": "v0.1.0-canary.134",
                "manifestUrl": "https://example.test/thinkwork-release.json",
                "manifestSha256": "a" * 64,
            },
            "features": {
                "baseInstall": {
                    "cognee": False,
                    "slack": False,
                    "stripe": False,
                    "twenty": False,
                },
                "optionalApps": [],
            },
        }
    )

    assert summary["contract"] == "thinkwork.deployment.controller.v1"
    assert summary["customer"]["environmentName"] == "tei-e2e"
    assert summary["release"]["manifestSha256"] == "a" * 64
    assert summary["features"]["baseInstall"] == {
        "cognee": False,
        "slack": False,
        "stripe": False,
        "twenty": False,
    }
    assert "firstAdmin" not in summary
    assert "do-not-record" not in json.dumps(summary)


def test_controller_status_action_writes_noop_proof(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(runner, "WORK", tmp_path / "work")
    monkeypatch.setenv("THINKWORK_DEPLOYMENT_ACTION", "status")
    monkeypatch.setenv(
        "THINKWORK_DEPLOYMENT_INPUT",
        json.dumps(
            {
                "schemaVersion": 1,
                "contract": "thinkwork.deployment.controller.v1",
                "action": "status",
                "sessionId": "session-1",
                "environmentName": "tei-e2e",
                "awsAccountId": "123456789012",
                "awsRegion": "us-east-1",
                "release": {
                    "version": "v0.1.0-canary.134",
                    "manifestUrl": "https://example.com/thinkwork-release.json",
                    "manifestSha256": "a" * 64,
                },
            }
        ),
    )
    monkeypatch.setenv(
        "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
        "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
    )
    monkeypatch.setenv(
        "THINKWORK_DEPLOYMENT_STATE_MACHINE_NAME",
        "thinkwork-tei-e2e-deployment-orchestrator",
    )
    monkeypatch.setenv("THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME", "runner")
    monkeypatch.setenv(
        "THINKWORK_DEPLOYMENT_RUNNER_PROJECT_ARN",
        "arn:aws:codebuild:us-east-1:123456789012:project/runner",
    )
    monkeypatch.setenv("THINKWORK_EVIDENCE_BUCKET", "evidence-bucket")
    monkeypatch.setenv("THINKWORK_SSM_PREFIX", "/thinkwork/tei-e2e/deployment")
    monkeypatch.setattr(runner, "run", lambda *_args, **_kwargs: None)

    assert runner.main() == 0

    proof = json.loads((tmp_path / "controller-status.json").read_text())
    evidence = json.loads((tmp_path / "deployment-evidence.json").read_text())
    assert proof["status"] == "ready"
    assert proof["controller"]["stateMachineName"] == ("thinkwork-tei-e2e-deployment-orchestrator")
    assert proof["release"]["version"] == "v0.1.0-canary.134"
    assert evidence["status"] == "succeeded"
    assert evidence["controller"]["status"]["proof"]["action"] == "status"


def test_runtime_profile_contains_customer_authority_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.134")
    monkeypatch.setenv(
        "THINKWORK_RELEASE_MANIFEST_URL",
        "https://example.com/thinkwork-release.json",
    )
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_SHA256", "a" * 64)
    outputs = {
        "api_endpoint": {"value": "https://api.example.com"},
        "app_url": {"value": "https://app.example.com"},
        "appsync_api_url": {"value": "https://appsync.example.com/graphql"},
        "appsync_realtime_url": {"value": "wss://appsync.example.com/graphql"},
        "appsync_api_key": {"value": "api-key"},
        "auth_domain": {"value": "thinkwork-tei-e2e"},
        "user_pool_id": {"value": "us-east-1_abc"},
        "admin_client_id": {"value": "client-id"},
        "deployment_state_machine_arn": {
            "value": "arn:aws:states:us-east-1:123456789012:stateMachine:controller"
        },
        "deployment_state_machine_name": {"value": "controller"},
        "deployment_runner_project_name": {"value": "runner"},
        "deployment_runner_project_arn": {
            "value": "arn:aws:codebuild:us-east-1:123456789012:project/runner"
        },
        "deployment_evidence_bucket_name": {"value": "evidence-bucket"},
        "deployment_ssm_prefix": {"value": "/thinkwork/tei-e2e/deployment"},
    }
    profile, web_env = runner.runtime_profile(
        outputs,
        {
            "stage": "tei-e2e",
            "region": "us-east-1",
            "account_id": "123456789012",
        },
    )

    assert profile["accountId"] == "123456789012"
    assert profile["releaseVersion"] == "v0.1.0-canary.134"
    assert profile["releaseManifestSha256"] == "a" * 64
    assert profile["controller"]["stateMachineArn"].endswith(":stateMachine:controller")
    assert profile["controller"]["codebuildProjectArn"].endswith(":project/runner")
    assert "VITE_DEPLOYMENT_CONTROLLER_ARN=" in web_env
    assert "VITE_RELEASE_MANIFEST_SHA256=" in web_env


def test_redacted_tfvars_removes_secret_values() -> None:
    runner = load_runner()

    redacted = runner.redacted_tfvars(
        {
            "stage": "tei-e2e",
            "db_password": "secret-db",
            "api_auth_secret": "secret-api",
            "google_oauth_client_secret": "secret-google",
        }
    )

    assert redacted == {
        "stage": "tei-e2e",
        "db_password": "[redacted]",
        "api_auth_secret": "[redacted]",
        "google_oauth_client_secret": "[redacted]",
    }


def test_write_controller_release_selection_to_ssm_persists_selected_release(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    calls: list[list[str]] = []

    monkeypatch.setenv("THINKWORK_SSM_PREFIX", "/thinkwork/tei-e2e/deployment")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    selected = runner.write_controller_release_selection_to_ssm(
        {
            "deployment_release_version": "v0.1.0-canary.147",
            "deployment_release_manifest_url": "https://example.test/thinkwork-release.json",
            "deployment_release_manifest_sha256": "f" * 64,
            "deployment_release_manifest_signature_url": "",
            "deployment_release_manifest_trust_policy": "allow_unsigned_canary",
            "deployment_release_manifest_trusted_keys_json": "[]",
            "deployment_terraform_module_source": "thinkwork-ai/thinkwork/aws",
            "deployment_terraform_module_version": "",
        }
    )

    written = {call[7]: call[9] for call in calls}
    assert selected["terraform-module-version"] == "0.1.0-canary.147"
    assert written == {
        "/thinkwork/tei-e2e/deployment/selected-release-version": "v0.1.0-canary.147",
        "/thinkwork/tei-e2e/deployment/selected-release-manifest-url": (
            "https://example.test/thinkwork-release.json"
        ),
        "/thinkwork/tei-e2e/deployment/selected-release-manifest-sha256": "f" * 64,
        "/thinkwork/tei-e2e/deployment/selected-release-trust-policy": "allow_unsigned_canary",
        "/thinkwork/tei-e2e/deployment/selected-release-trusted-keys-json": "[]",
        "/thinkwork/tei-e2e/deployment/terraform-module-source": "thinkwork-ai/thinkwork/aws",
        "/thinkwork/tei-e2e/deployment/terraform-module-version": "0.1.0-canary.147",
    }


def test_write_controller_release_selection_to_ssm_skips_empty_git_module_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = load_runner()
    calls: list[list[str]] = []

    monkeypatch.setenv("THINKWORK_SSM_PREFIX", "/thinkwork/dev/deployment")
    monkeypatch.setattr(runner, "run", lambda args, **_kwargs: calls.append(args))

    selected = runner.write_controller_release_selection_to_ssm(
        {
            "deployment_release_version": "v0.1.0-canary.147",
            "deployment_release_manifest_url": "https://example.test/thinkwork-release.json",
            "deployment_release_manifest_sha256": "f" * 64,
            "deployment_release_manifest_trust_policy": "allow_unsigned_canary",
            "deployment_release_manifest_trusted_keys_json": "[]",
            "deployment_terraform_module_source": (
                "git::https://github.com/thinkwork-ai/thinkwork.git"
                "//terraform/modules/thinkwork?ref=37d7246"
            ),
            "deployment_terraform_module_version": "",
        }
    )

    written_names = [call[7] for call in calls]
    assert "terraform-module-version" not in selected
    assert "/thinkwork/dev/deployment/terraform-module-version" not in written_names


def test_terraform_plan_summary_counts_resource_actions() -> None:
    runner = load_runner()

    summary = runner.terraform_plan_summary(
        {
            "format_version": "1.2",
            "terraform_version": "1.8.0",
            "resource_changes": [
                {"change": {"actions": ["create"]}},
                {"change": {"actions": ["update"]}},
                {"change": {"actions": ["delete", "create"]}},
                {"change": {"actions": ["create"]}},
            ],
        }
    )

    assert summary == {
        "formatVersion": "1.2",
        "terraformVersion": "1.8.0",
        "resourceChangeCount": 4,
        "resourceChangesByAction": {
            "create": 2,
            "update": 1,
            "delete,create": 1,
        },
    }


def test_self_update_runner_script_copies_release_runner_to_s3(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    source_dir = tmp_path / "source"
    script = source_dir / "terraform/modules/app/deployment-control-plane/runner.py"
    script.parent.mkdir(parents=True)
    script.write_text("# release runner\n", encoding="utf-8")

    monkeypatch.setattr(runner, "SOURCE", source_dir)
    monkeypatch.setenv(
        "THINKWORK_RUNNER_SCRIPT_S3_URI",
        "s3://evidence-bucket/runner/thinkwork-runner.py",
    )
    calls: list[list[str]] = []
    monkeypatch.setattr(runner, "run", lambda args, **_kw: calls.append(args))

    runner.self_update_runner_script()

    assert calls == [
        [
            "aws",
            "s3",
            "cp",
            str(script),
            "s3://evidence-bucket/runner/thinkwork-runner.py",
        ]
    ]


def test_self_update_runner_script_skips_when_source_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    monkeypatch.setattr(runner, "SOURCE", tmp_path / "missing-source")
    monkeypatch.setenv(
        "THINKWORK_RUNNER_SCRIPT_S3_URI",
        "s3://evidence-bucket/runner/thinkwork-runner.py",
    )
    calls: list[list[str]] = []
    monkeypatch.setattr(runner, "run", lambda args, **_kw: calls.append(args))

    runner.self_update_runner_script()

    assert calls == []


# ---------------------------------------------------------------------------
# First-admin bootstrap (first-run provisioning)
# ---------------------------------------------------------------------------


def test_first_admin_tenant_slug_prefers_customer_domain_label() -> None:
    runner = load_runner()
    slug = runner.first_admin_tenant_slug(
        {}, {}, {"stage": "acme-prod", "customer_domain": "acme.thinkwork.ai"}
    )
    assert slug == "acme"


def test_first_admin_tenant_slug_falls_back_to_stage() -> None:
    runner = load_runner()
    slug = runner.first_admin_tenant_slug({}, {}, {"stage": "acme", "customer_domain": ""})
    assert slug == "acme"


def test_first_admin_tenant_slug_rejects_domain_mismatch() -> None:
    runner = load_runner()
    with pytest.raises(RuntimeError, match="KTD8"):
        runner.first_admin_tenant_slug(
            {},
            {"tenantSlug": "other"},
            {"stage": "acme", "customer_domain": "acme.thinkwork.ai"},
        )


def test_first_admin_tenant_slug_rejects_invalid_slug() -> None:
    runner = load_runner()
    with pytest.raises(RuntimeError, match="slug pattern"):
        runner.first_admin_tenant_slug({}, {}, {"stage": "Bad_Stage!", "customer_domain": ""})


def test_first_admin_email_takes_first_valid_entry() -> None:
    runner = load_runner()
    assert (
        runner.first_admin_email({"platform_operator_emails": "ops@acme.com, two@acme.com"})
        == "ops@acme.com"
    )
    assert runner.first_admin_email({"platform_operator_emails": ""}) == ""
    assert runner.first_admin_email({"platform_operator_emails": "not-an-email"}) == ""
    assert runner.first_admin_email({"platform_operator_emails": "a'b@acme.com"}) == ""


def test_ensure_first_admin_skips_without_admin_email(tmp_path: Path) -> None:
    runner = load_runner()
    outputs = tmp_path / "outputs.json"
    outputs.write_text("{}", encoding="utf-8")
    runner.ensure_first_admin(outputs, {"platform_operator_emails": "", "stage": "acme"}, {}, {})
    assert runner.FIRST_ADMIN_EVIDENCE["status"] == "skipped"


def test_ensure_first_admin_skips_established_env_without_slug(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    outputs = tmp_path / "outputs.json"
    outputs.write_text(json.dumps({"user_pool_id": {"value": "us-east-1_POOL"}}), encoding="utf-8")
    monkeypatch.setattr(runner, "database_url_from_outputs", lambda _o: "postgres://x")

    def fake_psql_output(_url, sql):
        if "count(*)" in sql:
            return "3"
        return ""  # slug not present

    monkeypatch.setattr(runner, "psql_output", fake_psql_output)
    runner.ensure_first_admin(
        outputs,
        {"platform_operator_emails": "ops@acme.com", "stage": "acme", "customer_domain": ""},
        {},
        {},
    )
    assert runner.FIRST_ADMIN_EVIDENCE["status"] == "skipped"
    assert "3 tenant(s)" in runner.FIRST_ADMIN_EVIDENCE["reason"]


def test_ensure_first_admin_provisions_fresh_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    outputs = tmp_path / "outputs.json"
    outputs.write_text(json.dumps({"user_pool_id": {"value": "us-east-1_POOL"}}), encoding="utf-8")
    monkeypatch.setattr(runner, "database_url_from_outputs", lambda _o: "postgres://x")

    state = {"sql_calls": [], "cognito_calls": [], "seeded": 0}

    def fake_psql_output(_url, sql):
        if "count(*)" in sql:
            return "0"
        if "SELECT id FROM public.tenants" in sql:
            return "tenant-uuid-1"
        return ""

    def fake_psql(_url, sql=None, file=None, variables=None):
        state["sql_calls"].append((sql, variables))

    def fake_ensure_user(pool, email, region):
        state["cognito_calls"].append(("ensure", pool, email, region))
        return "sub-123", True

    def fake_cognito_idp(args, region, check=True):
        state["cognito_calls"].append((args[0], tuple(args), region))

        class R:
            returncode = 0
            stdout = "{}"
            stderr = ""

        return R()

    monkeypatch.setattr(runner, "psql_output", fake_psql_output)
    monkeypatch.setattr(runner, "psql", fake_psql)
    monkeypatch.setattr(runner, "ensure_first_admin_cognito_user", fake_ensure_user)
    monkeypatch.setattr(runner, "cognito_idp", fake_cognito_idp)
    monkeypatch.setattr(
        runner, "seed_platform_bootstrap_defaults", lambda _url: state.__setitem__("seeded", state["seeded"] + 1)
    )

    runner.ensure_first_admin(
        outputs,
        {
            "platform_operator_emails": "ops@acme.com",
            "stage": "acme-prod",
            "region": "us-east-1",
            "customer_domain": "acme.thinkwork.ai",
        },
        {},
        {},
    )

    assert runner.FIRST_ADMIN_EVIDENCE["status"] == "succeeded"
    assert runner.FIRST_ADMIN_EVIDENCE["tenantSlug"] == "acme"
    assert runner.FIRST_ADMIN_EVIDENCE["tenantId"] == "tenant-uuid-1"
    assert runner.FIRST_ADMIN_EVIDENCE["cognitoUserCreated"] is True

    sql, variables = state["sql_calls"][0]
    assert "INSERT INTO public.spaces" in sql
    assert variables["tenant_slug"] == "acme"
    assert variables["admin_email"] == "ops@acme.com"
    assert variables["cognito_sub"] == "sub-123"

    attr_calls = [c for c in state["cognito_calls"] if c[0] == "admin-update-user-attributes"]
    assert attr_calls and "Name=custom:tenant_id,Value=tenant-uuid-1" in attr_calls[0][1]
    assert state["seeded"] == 1


def test_ensure_first_admin_failure_is_nonfatal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    outputs = tmp_path / "outputs.json"
    outputs.write_text("{}", encoding="utf-8")  # missing user_pool_id
    runner.ensure_first_admin(
        outputs,
        {"platform_operator_emails": "ops@acme.com", "stage": "acme", "customer_domain": ""},
        {},
        {},
    )
    assert runner.FIRST_ADMIN_EVIDENCE["status"] == "failed"
    assert "user_pool_id" in runner.FIRST_ADMIN_EVIDENCE["error"]
