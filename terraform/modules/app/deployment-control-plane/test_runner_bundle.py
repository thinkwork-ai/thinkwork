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
    assert {artifact["source"] for artifact in runner.RELEASE_EVIDENCE["artifacts"]} == {
        "bundle"
    }


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
