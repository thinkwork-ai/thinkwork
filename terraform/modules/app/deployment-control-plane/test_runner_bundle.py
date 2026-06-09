import importlib.util
import io
import json
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


def release_manifest(bundle_path: Path, bundle_sha: str, artifacts: list[dict]) -> dict:
    return {
        "schemaVersion": 1,
        "release": {
            "version": "0.1.0-canary.134",
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
    assert runner.RELEASE_EVIDENCE["bundles"][0]["contains"] == ["graphql-http", "web"]
    assert {artifact["source"] for artifact in runner.RELEASE_EVIDENCE["artifacts"]} == {"bundle"}


def test_push_database_schema_updates_existing_db_with_platform_migrations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    source_dir = tmp_path / "source"
    outputs_path = tmp_path / "outputs.json"
    outputs_path.write_text("{}", encoding="utf-8")
    write_drizzle_files(source_dir, runner.PLATFORM_UPDATE_MIGRATIONS)
    calls: list[tuple[str, str | None]] = []

    monkeypatch.setattr(runner, "SOURCE", source_dir)
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_SOURCE", "thinkwork-ai/thinkwork/aws")
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.141")
    monkeypatch.setattr(runner, "checkout_source", lambda *_args: None)
    monkeypatch.setattr(runner, "database_url_from_outputs", lambda _outputs: "postgres://db")
    monkeypatch.setattr(
        runner,
        "psql_output",
        lambda _database_url, _sql: "public.tenants",
    )
    monkeypatch.setattr(
        runner,
        "initialize_greenfield_database",
        lambda *_args: calls.append(("initialize", None)),
    )
    monkeypatch.setattr(
        runner,
        "seed_platform_bootstrap_defaults",
        lambda _database_url: calls.append(("seed", None)),
    )

    def record_psql(_database_url, sql=None, file=None, variables=None):
        calls.append(("psql", Path(file).name if file else "sql"))

    monkeypatch.setattr(runner, "psql", record_psql)

    runner.push_database_schema(outputs_path, {"stage": "tei-e2e"})

    assert calls == [
        ("psql", "0149_user_model_approvals.sql"),
        ("psql", "0152_agent_profiles.sql"),
        ("psql", "0155_tenant_model_catalog.sql"),
        ("seed", None),
        ("psql", "0155_tenant_model_catalog.sql"),
    ]


def test_push_database_schema_backfills_tenant_catalog_after_greenfield_seed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = load_runner()
    source_dir = tmp_path / "source"
    outputs_path = tmp_path / "outputs.json"
    outputs_path.write_text("{}", encoding="utf-8")
    write_drizzle_files(source_dir, runner.PLATFORM_UPDATE_MIGRATIONS)
    calls: list[tuple[str, str | None]] = []

    monkeypatch.setattr(runner, "SOURCE", source_dir)
    monkeypatch.setenv("THINKWORK_TERRAFORM_MODULE_SOURCE", "thinkwork-ai/thinkwork/aws")
    monkeypatch.setenv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.141")
    monkeypatch.setattr(runner, "checkout_source", lambda *_args: None)
    monkeypatch.setattr(runner, "database_url_from_outputs", lambda _outputs: "postgres://db")
    monkeypatch.setattr(runner, "psql_output", lambda _database_url, _sql: "")
    monkeypatch.setattr(
        runner,
        "initialize_greenfield_database",
        lambda *_args: calls.append(("initialize", None)),
    )
    monkeypatch.setattr(
        runner,
        "seed_platform_bootstrap_defaults",
        lambda _database_url: calls.append(("seed", None)),
    )

    def record_psql(_database_url, sql=None, file=None, variables=None):
        calls.append(("psql", Path(file).name if file else "sql"))

    monkeypatch.setattr(runner, "psql", record_psql)

    runner.push_database_schema(outputs_path, {"stage": "tei-e2e"})

    assert calls == [
        ("initialize", None),
        ("psql", "0149_user_model_approvals.sql"),
        ("psql", "0152_agent_profiles.sql"),
        ("psql", "0155_tenant_model_catalog.sql"),
        ("seed", None),
        ("psql", "0155_tenant_model_catalog.sql"),
    ]


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
