import base64
import importlib.util
import io
import json
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
    new_manifest_url = "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.146/thinkwork-release.json"
    new_manifest_sha = "c3189ff697f9e407ffea197b5298cbe87679ff207aa29b15f8d74f74569b8440"

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
    assert 'ref=v0.1.0-canary.146' in main_tf
    assert "deployment_release_manifest_signature_url" in main_tf
    assert "deployment_release_manifest_trusted_keys_json" in main_tf
    assert "deployment_terraform_module_source" in main_tf


def _cognito_email_runner_env(
    runner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    tf_dir = tmp_path / "terraform"
    manifest_url = "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.150/thinkwork-release.json"
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
    monkeypatch.setenv("THINKWORK_RELEASE_MANIFEST_URL", manifest_url)
    monkeypatch.setenv(
        "THINKWORK_RELEASE_MANIFEST_SHA256",
        "f0a149db34d59e290fc4a43bc098a57539dcae508445e0fb626b8ce45f9eaf1c",
    )
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
