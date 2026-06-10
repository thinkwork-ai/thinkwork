import base64
import hashlib
import json
import os
import secrets
import subprocess
import tarfile
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

WORK = Path("/tmp/thinkwork-platform-deploy")
RELEASE = WORK / "release"
SOURCE = WORK / "source"
TF = WORK / "terraform"
MANIFEST = RELEASE / "thinkwork-release.json"
STARTED_AT = datetime.now(UTC).isoformat()
RELEASE_EVIDENCE = {}
CONTROLLER_EVIDENCE = {}
TERRAFORM_EVIDENCE = {}
RELEASE_MANIFEST_TRUST_POLICIES = {
    "allow_unsigned_canary",
    "require_signature",
}
PLATFORM_UPDATE_MIGRATIONS = [
    "0149_user_model_approvals.sql",
    "0152_agent_profiles.sql",
    "0155_tenant_model_catalog.sql",
]


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def output(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json_env(name, default):
    value = os.environ.get(name)
    if not value:
        return default
    return json.loads(value)


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        destination.write_bytes(response.read())


def stable_json_bytes(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def release_manifest_sha256(manifest):
    return hashlib.sha256(stable_json_bytes(manifest)).hexdigest()


def release_manifest_trust_policy():
    policy = os.environ.get(
        "THINKWORK_RELEASE_MANIFEST_TRUST_POLICY",
        "allow_unsigned_canary",
    ).strip()
    if not policy:
        policy = "allow_unsigned_canary"
    if policy not in RELEASE_MANIFEST_TRUST_POLICIES:
        raise RuntimeError(
            "Unsupported release manifest trust policy "
            f"{policy!r}; expected one of {sorted(RELEASE_MANIFEST_TRUST_POLICIES)}"
        )
    return policy


def is_canary_release(manifest):
    version = str(
        manifest.get("release", {}).get("version")
        or os.environ.get("THINKWORK_RELEASE_VERSION")
        or ""
    )
    return "-canary" in version


def default_signature_url(manifest_url):
    if manifest_url.endswith("/thinkwork-release.json"):
        return manifest_url[: -len("thinkwork-release.json")] + "thinkwork-release.sig.json"
    if manifest_url.endswith("thinkwork-release.json"):
        return manifest_url[: -len("thinkwork-release.json")] + "thinkwork-release.sig.json"
    return ""


def trusted_release_keys():
    raw = os.environ.get("THINKWORK_RELEASE_MANIFEST_TRUSTED_KEYS_JSON", "[]")
    try:
        keys = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("THINKWORK_RELEASE_MANIFEST_TRUSTED_KEYS_JSON must be JSON") from exc
    if not isinstance(keys, list):
        raise RuntimeError("THINKWORK_RELEASE_MANIFEST_TRUSTED_KEYS_JSON must be a JSON array")
    return keys


def require_string(value, path):
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"{path} is required")
    return value


def assert_time_window(now, not_before, expires_at, label):
    start = datetime.fromisoformat(require_string(not_before, f"{label}.notBefore").replace("Z", "+00:00"))
    end = datetime.fromisoformat(require_string(expires_at, f"{label}.expiresAt").replace("Z", "+00:00"))
    if now < start:
        raise RuntimeError(f"{label} is not valid before {not_before}")
    if now > end:
        raise RuntimeError(f"{label} expired at {expires_at}")


def verify_signature_bytes(public_key_pem, signed_bytes, signature_bytes):
    with TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        key_path = temp / "trusted-release-key.pem"
        payload_path = temp / "manifest.canonical.json"
        signature_path = temp / "thinkwork-release.sig"
        key_path.write_text(public_key_pem, encoding="utf-8")
        payload_path.write_bytes(signed_bytes)
        signature_path.write_bytes(signature_bytes)
        result = subprocess.run(
            [
                "openssl",
                "pkeyutl",
                "-verify",
                "-rawin",
                "-pubin",
                "-inkey",
                str(key_path),
                "-sigfile",
                str(signature_path),
                "-in",
                str(payload_path),
            ],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        raise RuntimeError(f"Release manifest signature is invalid: {result.stderr.strip()}")


def verify_release_manifest_signature(manifest, manifest_sha256, signature_url):
    signature_path = RELEASE / "thinkwork-release.sig.json"
    download(signature_url, signature_path)
    signature = json.loads(signature_path.read_text(encoding="utf-8"))
    if signature.get("schemaVersion") != 1:
        raise RuntimeError("Release manifest signature schemaVersion must be 1")
    if signature.get("algorithm") != "ed25519":
        raise RuntimeError("Release manifest signature algorithm must be ed25519")
    key_id = require_string(signature.get("keyId"), "signature.keyId")
    if signature.get("manifestSha256") != manifest_sha256:
        raise RuntimeError(
            "Release manifest signature digest mismatch: "
            f"expected {signature.get('manifestSha256')}, got {manifest_sha256}"
        )
    signing = manifest.get("signing") or {}
    accepted_key_ids = signing.get("acceptedKeyIds") or []
    revoked_key_ids = set(signing.get("revokedKeyIds") or [])
    if key_id in revoked_key_ids:
        raise RuntimeError(f"Release manifest signing key is revoked: {key_id}")
    if key_id not in accepted_key_ids:
        raise RuntimeError(f"Release manifest does not accept signing key: {key_id}")
    now = datetime.now(UTC)
    assert_time_window(now, signature.get("notBefore"), signature.get("expiresAt"), "signature")
    trusted_key = next((key for key in trusted_release_keys() if key.get("keyId") == key_id), None)
    if not trusted_key:
        raise RuntimeError(f"Release manifest signing key is not trusted: {key_id}")
    if trusted_key.get("notBefore") or trusted_key.get("expiresAt"):
        assert_time_window(
            now,
            trusted_key.get("notBefore", "1970-01-01T00:00:00.000Z"),
            trusted_key.get("expiresAt", "9999-12-31T23:59:59.999Z"),
            f"trusted key {key_id}",
        )
    verify_signature_bytes(
        require_string(trusted_key.get("publicKeyPem"), f"trusted key {key_id}.publicKeyPem"),
        stable_json_bytes(manifest),
        base64.b64decode(require_string(signature.get("signature"), "signature.signature")),
    )
    return {
        "signatureVerified": True,
        "keyId": key_id,
        "signatureUrl": signature_url,
    }


def enforce_release_manifest_trust(manifest, manifest_digest, manifest_url):
    policy = release_manifest_trust_policy()
    configured_signature_url = os.environ.get("THINKWORK_RELEASE_MANIFEST_SIGNATURE_URL", "")
    signature_url = configured_signature_url or default_signature_url(manifest_url)
    evidence = {
        "policy": policy,
        "signatureRequired": policy == "require_signature",
        "signatureVerified": False,
        "unsignedCanaryAllowed": False,
    }
    if policy == "require_signature":
        if not signature_url:
            raise RuntimeError("Release manifest signature URL is required by trust policy")
        evidence.update(verify_release_manifest_signature(manifest, manifest_digest, signature_url))
        return evidence

    if configured_signature_url:
        evidence.update(verify_release_manifest_signature(manifest, manifest_digest, configured_signature_url))
        return evidence

    if not is_canary_release(manifest):
        raise RuntimeError(
            "Unsigned release manifest is only allowed for canary releases; "
            "set THINKWORK_RELEASE_MANIFEST_TRUST_POLICY=require_signature for customer-safe runs"
        )
    evidence["unsignedCanaryAllowed"] = True
    return evidence


def safe_join(base, relative_path):
    relative = Path(relative_path)
    if relative.is_absolute():
        raise RuntimeError(f"Archive member path must be relative: {relative_path}")
    resolved_base = base.resolve()
    resolved = (base / relative).resolve()
    if resolved != resolved_base and resolved_base not in resolved.parents:
        raise RuntimeError(f"Archive member escapes destination: {relative_path}")
    return resolved


def safe_extract_tar_file(archive_path, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "r:*") as tar:
        members = tar.getmembers()
        for member in members:
            if member.issym() or member.islnk():
                raise RuntimeError(f"Archive member links are not allowed: {member.name}")
            if not (member.isfile() or member.isdir()):
                raise RuntimeError(f"Archive member type is not allowed: {member.name}")
            safe_join(destination, member.name)
        tar.extractall(destination, members=members)


def release_artifacts_by_name(manifest):
    return {
        artifact.get("name"): artifact
        for artifact in manifest.get("artifacts", [])
        if isinstance(artifact.get("name"), str)
    }


def artifact_bundle_url(bundle):
    url = bundle.get("url")
    if not url:
        raise RuntimeError(f"Release artifact bundle {bundle.get('name')} is missing url")
    return url


def bundle_extract_dir(bundle):
    name = str(bundle.get("name") or "platform")
    safe_name = "".join(ch if ch.isalnum() or ch in "._=-" else "_" for ch in name)
    return RELEASE / "bundles" / safe_name


def download_and_extract_artifact_bundles(manifest):
    artifacts = release_artifacts_by_name(manifest)
    bundled_paths = {}
    bundle_evidence = []

    for bundle in manifest.get("artifactBundles", []) or []:
        bundle_name = bundle.get("name")
        bundle_path = safe_join(
            RELEASE,
            str(bundle.get("relativePath") or bundle.get("fileName")),
        )
        download(artifact_bundle_url(bundle), bundle_path)
        digest = sha256_file(bundle_path)
        if digest != bundle.get("sha256"):
            raise RuntimeError(f"Artifact bundle digest mismatch for {bundle_name}")

        extract_dir = bundle_extract_dir(bundle)
        safe_extract_tar_file(bundle_path, extract_dir)

        contained = []
        for artifact_name in bundle.get("contains", []):
            artifact = artifacts.get(artifact_name)
            if not artifact:
                raise RuntimeError(
                    f"Release artifact bundle {bundle_name} references unknown artifact {artifact_name}"
                )
            artifact_path = safe_join(extract_dir, artifact["relativePath"])
            if not artifact_path.is_file():
                raise RuntimeError(
                    f"Release artifact {artifact_name} is missing from bundle {bundle_name}"
                )
            bundled_paths[artifact_name] = artifact_path
            contained.append(artifact_name)

        bundle_evidence.append(
            {
                "name": bundle_name,
                "fileName": bundle.get("fileName"),
                "sha256": digest,
                "contains": contained,
            }
        )

    return bundled_paths, bundle_evidence


def materialize_release_artifact(artifact, bundled_paths):
    destination = safe_join(RELEASE, artifact["relativePath"])
    url = artifact.get("url")
    if url:
        download(url, destination)
        source = "url"
    else:
        bundled_path = bundled_paths.get(artifact.get("name"))
        if not bundled_path:
            raise RuntimeError(
                f"Release artifact {artifact.get('name')} is missing url and is not available in an artifact bundle"
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.resolve() != bundled_path.resolve():
            destination.write_bytes(bundled_path.read_bytes())
        source = "bundle"

    digest = sha256_file(destination)
    if digest != artifact.get("sha256"):
        raise RuntimeError(f"Artifact digest mismatch for {artifact.get('name')}")
    return destination, digest, source


def evidence_s3_uri(name):
    prefix = os.environ.get("THINKWORK_EVIDENCE_PREFIX")
    bucket = os.environ.get("THINKWORK_EVIDENCE_BUCKET")
    if not prefix or not bucket:
        return ""
    return f"s3://{bucket}/{prefix}/{name}"


def upload_evidence_artifact(path, name=None):
    artifact_name = name or Path(path).name
    uri = evidence_s3_uri(artifact_name)
    if uri:
        run(["aws", "s3", "cp", str(path), uri])
    return uri


def write_json_evidence_artifact(name, payload):
    path = Path(name)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "fileName": name,
        "sha256": sha256_file(path),
        "s3Uri": upload_evidence_artifact(path, name),
    }


def redacted_tfvars(vars_json):
    redacted = dict(vars_json)
    for key in [
        "api_auth_secret",
        "db_password",
        "google_oauth_client_secret",
    ]:
        if key in redacted:
            redacted[key] = "[redacted]"
    return redacted


def controller_input_summary(payload):
    release = payload.get("release")
    if not isinstance(release, dict):
        release = {
            "version": payload.get("releaseVersion") or os.environ.get("THINKWORK_RELEASE_VERSION"),
            "manifestUrl": payload.get("releaseManifestUrl")
            or os.environ.get("THINKWORK_RELEASE_MANIFEST_URL"),
            "manifestSha256": payload.get("releaseManifestSha256")
            or os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256"),
        }
    return {
        "schemaVersion": payload.get("schemaVersion"),
        "contract": payload.get("contract"),
        "phase": payload.get("phase"),
        "action": payload.get("action"),
        "sessionId": payload.get("sessionId"),
        "customer": {
            "name": payload.get("customerName"),
            "environmentName": payload.get("environmentName"),
            "awsAccountId": payload.get("awsAccountId"),
            "awsRegion": payload.get("awsRegion"),
            "availabilityZones": payload.get("availabilityZones"),
        },
        "evidence": payload.get("evidence")
        or {
            "bucket": payload.get("evidenceBucket") or os.environ.get("THINKWORK_EVIDENCE_BUCKET"),
            "prefix": os.environ.get("THINKWORK_EVIDENCE_PREFIX"),
        },
        "features": payload.get("features")
        or {
            "baseInstall": {
                "cognee": False,
                "slack": False,
                "stripe": False,
                "twenty": False,
            },
            "optionalApps": [],
        },
        "operation": payload.get("operation"),
        "release": release,
        "terraform": payload.get("terraform"),
    }


def controller_identity(payload):
    return {
        "stateMachineArn": os.environ.get("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN")
        or payload.get("stateMachineArn"),
        "stateMachineName": os.environ.get("THINKWORK_DEPLOYMENT_STATE_MACHINE_NAME"),
        "codebuildProjectName": os.environ.get("THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME"),
        "codebuildProjectArn": os.environ.get("THINKWORK_DEPLOYMENT_RUNNER_PROJECT_ARN"),
        "evidenceBucketName": os.environ.get("THINKWORK_EVIDENCE_BUCKET"),
        "ssmPrefix": os.environ.get("THINKWORK_SSM_PREFIX"),
    }


def release_selection(payload):
    release = payload.get("release")
    if isinstance(release, dict):
        return {
            "version": release.get("version")
            or payload.get("releaseVersion")
            or os.environ.get("THINKWORK_RELEASE_VERSION"),
            "manifestUrl": release.get("manifestUrl")
            or payload.get("releaseManifestUrl")
            or os.environ.get("THINKWORK_RELEASE_MANIFEST_URL"),
            "manifestSha256": release.get("manifestSha256")
            or payload.get("releaseManifestSha256")
            or os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256"),
            "manifestSignatureUrl": release.get("manifestSignatureUrl")
            or payload.get("releaseManifestSignatureUrl")
            or os.environ.get("THINKWORK_RELEASE_MANIFEST_SIGNATURE_URL"),
            "manifestTrustPolicy": release.get("manifestTrustPolicy")
            or payload.get("releaseManifestTrustPolicy")
            or os.environ.get("THINKWORK_RELEASE_MANIFEST_TRUST_POLICY"),
        }
    return {
        "version": payload.get("releaseVersion") or os.environ.get("THINKWORK_RELEASE_VERSION"),
        "manifestUrl": payload.get("releaseManifestUrl")
        or os.environ.get("THINKWORK_RELEASE_MANIFEST_URL"),
        "manifestSha256": payload.get("releaseManifestSha256")
        or os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256"),
        "manifestSignatureUrl": payload.get("releaseManifestSignatureUrl")
        or os.environ.get("THINKWORK_RELEASE_MANIFEST_SIGNATURE_URL"),
        "manifestTrustPolicy": payload.get("releaseManifestTrustPolicy")
        or os.environ.get("THINKWORK_RELEASE_MANIFEST_TRUST_POLICY"),
    }


def apply_release_selection(payload):
    selected = release_selection(payload)
    env_names = {
        "version": "THINKWORK_RELEASE_VERSION",
        "manifestUrl": "THINKWORK_RELEASE_MANIFEST_URL",
        "manifestSha256": "THINKWORK_RELEASE_MANIFEST_SHA256",
        "manifestSignatureUrl": "THINKWORK_RELEASE_MANIFEST_SIGNATURE_URL",
        "manifestTrustPolicy": "THINKWORK_RELEASE_MANIFEST_TRUST_POLICY",
    }
    for key, env_name in env_names.items():
        value = selected.get(key)
        if isinstance(value, str) and value:
            os.environ[env_name] = value
    return selected


def write_controller_status_evidence(payload):
    proof = {
        "schemaVersion": 1,
        "contract": "thinkwork.deployment.controller.status.v1",
        "status": "ready",
        "action": "status",
        "sessionId": payload.get("sessionId") or os.environ.get("THINKWORK_DEPLOYMENT_SESSION_ID"),
        "checkedAt": datetime.now(UTC).isoformat(),
        "controller": controller_identity(payload),
        "release": release_selection(payload),
    }
    return {
        "proof": proof,
        "artifact": write_json_evidence_artifact("controller-status.json", proof),
    }


def terraform_plan_summary(plan_json):
    resource_changes = plan_json.get("resource_changes", [])
    by_action = {}
    for change in resource_changes:
        actions = change.get("change", {}).get("actions", [])
        action_key = ",".join(actions) if actions else "unknown"
        by_action[action_key] = by_action.get(action_key, 0) + 1
    return {
        "formatVersion": plan_json.get("format_version"),
        "terraformVersion": plan_json.get("terraform_version"),
        "resourceChangeCount": len(resource_changes),
        "resourceChangesByAction": by_action,
    }


def write_terraform_plan_evidence():
    plan_path = Path("terraform-plan.json")
    with plan_path.open("w", encoding="utf-8") as handle:
        run(["terraform", "show", "-json", "tfplan"], cwd=TF, stdout=handle)
    plan_json = json.loads(plan_path.read_text(encoding="utf-8"))
    artifact = {
        "fileName": plan_path.name,
        "sha256": sha256_file(plan_path),
        "s3Uri": upload_evidence_artifact(plan_path),
    }
    return {
        "artifact": artifact,
        "summary": terraform_plan_summary(plan_json),
    }


def secret_payload(payload):
    arn = payload.get("runnerSecretArn") or payload.get("deploymentSecretsSecretArn")
    if not arn:
        return {}
    body = output(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            arn,
            "--query",
            "SecretString",
            "--output",
            "text",
        ]
    )
    return json.loads(body or "{}")


def safe_get(mapping, *names, default=""):
    for name in names:
        value = mapping.get(name)
        if isinstance(value, str) and value:
            return value
    return default


def existing_stage_secret_field(stage, field):
    try:
        body = output(
            [
                "aws",
                "secretsmanager",
                "get-secret-value",
                "--secret-id",
                f"thinkwork-{stage}-db-credentials",
                "--query",
                "SecretString",
                "--output",
                "text",
            ]
        )
        secret = json.loads(body or "{}")
        value = secret.get(field)
        return value if isinstance(value, str) else ""
    except Exception:
        return ""


def hcl_string(value):
    return json.dumps(value)


def release_runtime_image(name):
    if not MANIFEST.exists():
        return ""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for image in manifest.get("runtimeImages", []):
        if image.get("name") == name:
            return image.get("uri") or ""
    return ""


def release_git_sha():
    if not MANIFEST.exists():
        return ""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    release = manifest.get("release")
    if isinstance(release, dict):
        git_sha = release.get("gitSha")
        return git_sha if isinstance(git_sha, str) else ""
    return ""


def source_repo_and_ref(module_source, release_version):
    source = module_source.removeprefix("git::")
    source_path, _, query = source.partition("?")
    params = urllib.parse.parse_qs(query)
    ref = params.get("ref", [release_version])[0]
    if source_path == "thinkwork-ai/thinkwork/aws":
        repo = "https://github.com/thinkwork-ai/thinkwork.git"
        ref = release_git_sha() or release_version
    elif source_path.startswith("github.com/"):
        github_source = source_path
        if "//terraform/" in github_source:
            github_source = github_source.split("//terraform/", 1)[0]
        repo = f"https://{github_source.removesuffix('.git')}.git"
    elif ".git//" in source_path:
        repo = source_path.split(".git//", 1)[0] + ".git"
    elif "//terraform/" in source_path:
        repo = source_path.split("//terraform/", 1)[0]
    else:
        repo = source_path
    return repo, ref


def terraform_module_source_and_version(module_source, module_version, release_version):
    source = module_source.removeprefix("git::")
    source_path, _, _query = source.partition("?")
    if source_path == "thinkwork-ai/thinkwork/aws":
        ref = release_git_sha() or release_version
        quoted_ref = urllib.parse.quote(ref, safe="")
        return (
            "git::https://github.com/thinkwork-ai/thinkwork.git"
            f"//terraform/modules/thinkwork?ref={quoted_ref}",
            "",
        )
    return module_source, module_version


def checkout_source(module_source, release_version):
    if SOURCE.exists():
        return
    repo, ref = source_repo_and_ref(module_source, release_version)
    if not repo.startswith(("https://", "git@")):
        raise RuntimeError(f"Cannot initialize database schema from module source: {module_source}")
    run(["git", "clone", "--no-checkout", "--filter=blob:none", repo, str(SOURCE)])
    run(["git", "-C", str(SOURCE), "fetch", "--depth", "1", "origin", ref])
    run(["git", "-C", str(SOURCE), "checkout", "--detach", "FETCH_HEAD"])


def database_url_from_outputs(outputs):
    endpoint = outputs.get("db_cluster_endpoint", {}).get("value")
    secret_arn = outputs.get("db_secret_arn", {}).get("value")
    database_name = outputs.get("database_name", {}).get("value") or "thinkwork"
    if not endpoint or not secret_arn:
        raise RuntimeError("Terraform outputs missing database endpoint or secret ARN")
    body = output(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            str(secret_arn),
            "--query",
            "SecretString",
            "--output",
            "text",
        ]
    )
    secret = json.loads(body or "{}")
    username = secret.get("username") or "thinkwork_admin"
    password = secret.get("password") or ""
    if not password:
        raise RuntimeError("Database secret is missing password")
    return (
        "postgresql://"
        f"{urllib.parse.quote(str(username), safe='')}:"
        f"{urllib.parse.quote(str(password), safe='')}@"
        f"{endpoint}:5432/{database_name}?sslmode=require"
    )


def psql_env(database_url):
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    return env


def psql(database_url, sql=None, file=None, variables=None):
    args = ["psql", database_url, "-v", "ON_ERROR_STOP=1"]
    for key, value in (variables or {}).items():
        args.extend(["-v", f"{key}={value}"])
    if file:
        args.extend(["-f", str(file)])
        return run(args)
    return subprocess.run(args, input=sql, check=True, text=True)


def psql_output(database_url, sql):
    return output(["psql", database_url, "-tAc", sql])


def put_secret_value(secret_id, payload):
    run(
        [
            "aws",
            "secretsmanager",
            "put-secret-value",
            "--secret-id",
            secret_id,
            "--secret-string",
            json.dumps(payload),
        ]
    )


def ensure_compliance_roles(database_url, outputs, vars_json):
    stage = vars_json["stage"]
    endpoint = outputs.get("db_cluster_endpoint", {}).get("value")
    database_name = outputs.get("database_name", {}).get("value") or "thinkwork"
    secrets_by_role = {
        "writer_pass": ("compliance_writer", f"thinkwork/{stage}/compliance/writer-credentials"),
        "drainer_pass": ("compliance_drainer", f"thinkwork/{stage}/compliance/drainer-credentials"),
        "reader_pass": ("compliance_reader", f"thinkwork/{stage}/compliance/reader-credentials"),
    }
    variables = {}
    for variable, (username, secret_id) in secrets_by_role.items():
        password = secrets.token_urlsafe(36)
        variables[variable] = password
        put_secret_value(
            secret_id,
            {
                "username": username,
                "password": password,
                "host": endpoint,
                "port": 5432,
                "dbname": database_name,
            },
        )
    psql(
        database_url,
        file=SOURCE / "packages/database-pg/drizzle/0070_compliance_aurora_roles.sql",
        variables=variables,
    )


def initialize_greenfield_database(database_url, outputs, vars_json):
    migrations = SOURCE / "packages/database-pg/drizzle"
    psql(
        database_url,
        sql="""
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS ontology CASCADE;
DROP SCHEMA IF EXISTS compliance CASCADE;
DROP SCHEMA IF EXISTS brain CASCADE;
DROP SCHEMA IF EXISTS wiki CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
""",
    )
    files = sorted(path for path in migrations.glob("*.sql") if "rollback" not in path.name)
    for path in files:
        if path.name == "0031_thread_cleanup_drops.sql":
            psql(
                database_url,
                sql="""
DROP INDEX IF EXISTS public.idx_threads_tenant_status;
DROP INDEX IF EXISTS public.idx_threads_parent_id;
DROP TABLE IF EXISTS public.thread_comments CASCADE;
""",
            )
            continue
        if path.name == "0070_compliance_aurora_roles.sql":
            ensure_compliance_roles(database_url, outputs, vars_json)
            continue
        psql(database_url, file=path, variables={"stage": vars_json["stage"]})


def apply_platform_update_migrations(database_url, vars_json, migration_names):
    migrations = SOURCE / "packages/database-pg/drizzle"
    for name in migration_names:
        path = migrations / name
        if not path.is_file():
            raise RuntimeError(f"Required platform migration is missing: {path}")
        psql(database_url, file=path, variables={"stage": vars_json["stage"]})


def seed_platform_bootstrap_defaults(database_url):
    psql(
        database_url,
        sql="""
BEGIN;

INSERT INTO public.model_catalog (
  model_id,
  provider,
  display_name,
  input_cost_per_million,
  output_cost_per_million,
  context_window,
  max_output_tokens,
  supports_vision,
  supports_tools,
  is_available
) VALUES
  (
    'us.anthropic.claude-sonnet-4-6',
    'anthropic',
    'Claude Sonnet 4.6',
    3.00,
    15.00,
    200000,
    64000,
    true,
    true,
    true
  ),
  (
    'us.anthropic.claude-opus-4-6-v1',
    'anthropic',
    'Claude Opus 4.6',
    15.00,
    75.00,
    200000,
    32000,
    true,
    true,
    true
  ),
  (
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'anthropic',
    'Claude Haiku 4.5',
    0.80,
    4.00,
    200000,
    64000,
    true,
    true,
    true
  )
ON CONFLICT (model_id) DO UPDATE SET
  provider = EXCLUDED.provider,
  display_name = EXCLUDED.display_name,
  input_cost_per_million = EXCLUDED.input_cost_per_million,
  output_cost_per_million = EXCLUDED.output_cost_per_million,
  context_window = EXCLUDED.context_window,
  max_output_tokens = EXCLUDED.max_output_tokens,
  supports_vision = EXCLUDED.supports_vision,
  supports_tools = EXCLUDED.supports_tools,
  is_available = EXCLUDED.is_available,
  updated_at = now();

INSERT INTO public.tenant_settings (tenant_id, default_model)
SELECT id, 'us.anthropic.claude-sonnet-4-6'
FROM public.tenants
ON CONFLICT (tenant_id) DO UPDATE SET
  default_model = COALESCE(public.tenant_settings.default_model, EXCLUDED.default_model),
  updated_at = now();

INSERT INTO public.agents (
  tenant_id,
  name,
  slug,
  workspace_folder_name,
  source,
  runtime,
  status,
  system_prompt,
  model,
  is_platform_default
)
SELECT
  t.id,
  'ThinkWork Agent',
  'thinkwork-agent-' || left(md5(t.id::text), 12),
  'thinkwork-agent',
  'system',
  'pi',
  'idle',
  'You are ThinkWork Agent, the default assistant for this workspace.',
  'us.anthropic.claude-sonnet-4-6',
  true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.agents a
  WHERE a.tenant_id = t.id
    AND a.is_platform_default IS TRUE
);

UPDATE public.agents
SET model = 'us.anthropic.claude-sonnet-4-6',
    updated_at = now()
WHERE is_platform_default IS TRUE
  AND model IS NULL;

WITH default_models AS (
  SELECT tenant_id, default_model AS model_id
  FROM public.tenant_settings
  WHERE default_model IS NOT NULL
  UNION
  SELECT tenant_id, model AS model_id
  FROM public.agents
  WHERE model IS NOT NULL
  UNION
  SELECT tenant_id, model AS model_id
  FROM public.agent_templates
  WHERE model IS NOT NULL
),
available_defaults AS (
  SELECT DISTINCT
    u.tenant_id,
    u.id AS user_id,
    d.model_id
  FROM public.users u
  JOIN default_models d
    ON d.tenant_id = u.tenant_id
  JOIN public.model_catalog mc
    ON mc.model_id = d.model_id
   AND mc.is_available IS TRUE
  WHERE u.tenant_id IS NOT NULL
)
INSERT INTO public.user_model_approvals (tenant_id, user_id, model_id)
SELECT tenant_id, user_id, model_id
FROM available_defaults
ON CONFLICT (tenant_id, user_id, model_id) DO NOTHING;

COMMIT;
""",
    )


def push_database_schema(outputs_path, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    checkout_source(
        os.environ["THINKWORK_TERRAFORM_MODULE_SOURCE"],
        os.environ.get("THINKWORK_RELEASE_VERSION", "main"),
    )
    database_url = database_url_from_outputs(outputs)
    if not psql_output(database_url, "SELECT to_regclass('public.tenants')").strip():
        initialize_greenfield_database(database_url, outputs, vars_json)
    apply_platform_update_migrations(database_url, vars_json, PLATFORM_UPDATE_MIGRATIONS)
    seed_platform_bootstrap_defaults(database_url)
    apply_platform_update_migrations(
        database_url,
        vars_json,
        ["0155_tenant_model_catalog.sql"],
    )


def write_runner_files(payload, runner_secrets):
    stage = safe_get(
        payload,
        "stage",
        "environmentName",
        default=os.environ["THINKWORK_STAGE"],
    )
    region = safe_get(
        payload,
        "awsRegion",
        "region",
        default=os.environ.get("AWS_REGION") or "us-east-1",
    )
    account_id = safe_get(payload, "awsAccountId", "accountId", default="")
    if not account_id:
        account_id = output(
            ["aws", "sts", "get-caller-identity", "--query", "Account", "--output", "text"]
        )

    selected_release = release_selection(payload)
    release_version = selected_release.get("version") or "unresolved"
    release_manifest_url = selected_release.get("manifestUrl") or ""
    release_manifest_sha256 = selected_release.get("manifestSha256") or ""
    release_manifest_signature_url = selected_release.get("manifestSignatureUrl") or ""
    release_manifest_trust_policy_value = (
        selected_release.get("manifestTrustPolicy") or "allow_unsigned_canary"
    )
    if release_manifest_trust_policy_value not in RELEASE_MANIFEST_TRUST_POLICIES:
        raise RuntimeError(
            "Unsupported release manifest trust policy "
            f"{release_manifest_trust_policy_value!r}; expected one of "
            f"{sorted(RELEASE_MANIFEST_TRUST_POLICIES)}"
        )
    release_manifest_trusted_keys_json = json.dumps(
        trusted_release_keys(),
        separators=(",", ":"),
        sort_keys=True,
    )
    module_source = safe_get(
        payload,
        "terraformModuleSource",
        default=os.environ["THINKWORK_TERRAFORM_MODULE_SOURCE"],
    )
    module_version = safe_get(
        payload,
        "terraformModuleVersion",
        default=os.environ.get("THINKWORK_TERRAFORM_MODULE_VERSION", ""),
    )
    terraform_module_source, terraform_module_version = terraform_module_source_and_version(
        module_source,
        module_version,
        release_version,
    )
    module_version_line = (
        f"  version = {hcl_string(terraform_module_version)}\n" if terraform_module_version else ""
    )
    db_password = safe_get(
        runner_secrets,
        "dbPassword",
        "databasePassword",
        default=safe_get(payload, "dbPassword", "databasePassword", default=""),
    )
    if not db_password:
        db_password = existing_stage_secret_field(stage, "password")
    api_auth_secret = safe_get(
        runner_secrets,
        "apiAuthSecret",
        default=safe_get(payload, "apiAuthSecret", default=""),
    )
    if not db_password:
        db_password = secrets.token_urlsafe(36)
    if not api_auth_secret:
        api_auth_secret = secrets.token_urlsafe(48)

    vars_json = {
        "stage": stage,
        "region": region,
        "account_id": account_id,
        "db_password": db_password,
        "api_auth_secret": api_auth_secret,
        "database_engine": safe_get(
            payload,
            "databaseEngine",
            default="aurora-serverless",
        ),
        "enable_hindsight": bool(payload.get("enableHindsight", False)),
        "platform_operator_emails": safe_get(
            runner_secrets,
            "adminEmail",
            "platformOperatorEmails",
            default=safe_get(
                payload,
                "adminEmail",
                "platformOperatorEmails",
                default="",
            ),
        ),
        "google_oauth_client_id": safe_get(
            runner_secrets,
            "googleOauthClientId",
            default=safe_get(payload, "googleOauthClientId", default=""),
        ),
        "google_oauth_client_secret": safe_get(
            runner_secrets,
            "googleOauthClientSecret",
            default=safe_get(payload, "googleOauthClientSecret", default=""),
        ),
        "lambda_artifact_bucket": os.environ["THINKWORK_RELEASE_ARTIFACT_BUCKET"],
        "lambda_artifact_prefix": f"releases/{release_version}/lambdas",
        "deployment_release_version": release_version,
        "deployment_release_manifest_url": release_manifest_url,
        "deployment_release_manifest_sha256": release_manifest_sha256,
        "deployment_release_manifest_signature_url": release_manifest_signature_url,
        "deployment_release_manifest_trust_policy": release_manifest_trust_policy_value,
        "deployment_release_manifest_trusted_keys_json": release_manifest_trusted_keys_json,
        "deployment_terraform_module_source": module_source,
        "deployment_terraform_module_version": terraform_module_version,
        "agentcore_pi_source_image_uri": safe_get(
            payload,
            "agentcorePiSourceImageUri",
            default=release_runtime_image("agentcore-pi-amd64"),
        ),
    }

    TF.mkdir(parents=True, exist_ok=True)
    (TF / "backend.hcl").write_text(
        "\n".join(
            [
                f"bucket = {hcl_string(os.environ['THINKWORK_TERRAFORM_STATE_BUCKET'])}",
                f"key = {hcl_string(f'thinkwork/{stage}/terraform.tfstate')}",
                f"region = {hcl_string(region)}",
                f"dynamodb_table = {hcl_string(os.environ['THINKWORK_TERRAFORM_LOCK_TABLE'])}",
                "encrypt = true",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (TF / "terraform.auto.tfvars.json").write_text(
        json.dumps(vars_json, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    (TF / "main.tf").write_text(
        f"""
terraform {{
  required_version = ">= 1.5"

  backend "s3" {{}}

  required_providers {{
    aws = {{
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }}
    cloudflare = {{
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }}
  }}
}}

provider "aws" {{
  region = var.region
}}

provider "cloudflare" {{}}

variable "stage" {{
  type = string
}}

variable "region" {{
  type = string
}}

variable "account_id" {{
  type = string
}}

variable "db_password" {{
  type      = string
  sensitive = true
}}

variable "api_auth_secret" {{
  type      = string
  sensitive = true
}}

variable "database_engine" {{
  type = string
}}

variable "enable_hindsight" {{
  type = bool
}}

variable "platform_operator_emails" {{
  type = string
}}

variable "google_oauth_client_id" {{
  type = string
}}

variable "google_oauth_client_secret" {{
  type      = string
  sensitive = true
}}

variable "lambda_artifact_bucket" {{
  type = string
}}

variable "lambda_artifact_prefix" {{
  type = string
}}

variable "agentcore_pi_source_image_uri" {{
  type = string
}}

variable "deployment_release_version" {{
  type = string
}}

variable "deployment_release_manifest_url" {{
  type = string
}}

variable "deployment_release_manifest_sha256" {{
  type = string
}}

variable "deployment_release_manifest_signature_url" {{
  type = string
}}

variable "deployment_release_manifest_trust_policy" {{
  type = string
}}

variable "deployment_release_manifest_trusted_keys_json" {{
  type = string
}}

variable "deployment_terraform_module_source" {{
  type = string
}}

variable "deployment_terraform_module_version" {{
  type = string
}}

module "thinkwork" {{
  source  = {hcl_string(terraform_module_source)}
{module_version_line}

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  db_password     = var.db_password
  api_auth_secret = var.api_auth_secret
  database_engine = var.database_engine

  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  platform_operator_emails   = var.platform_operator_emails

  lambda_artifact_bucket   = var.lambda_artifact_bucket
  lambda_artifact_prefix   = var.lambda_artifact_prefix
  require_lambda_artifacts = true
  agentcore_pi_source_image_uri = var.agentcore_pi_source_image_uri

  enable_hindsight               = var.enable_hindsight
  enable_workspace_orchestration = true

  enable_cognee          = false
  twenty_provisioned     = false
  twenty_runtime_enabled = false
  enable_stripe_billing      = false
  enable_slack_workspace_app = false

  enable_deployment_control_plane    = false
  deployment_release_version         = var.deployment_release_version
  deployment_release_manifest_url    = var.deployment_release_manifest_url
  deployment_release_manifest_sha256 = var.deployment_release_manifest_sha256
  deployment_release_manifest_signature_url     = var.deployment_release_manifest_signature_url
  deployment_release_manifest_trust_policy      = var.deployment_release_manifest_trust_policy
  deployment_release_manifest_trusted_keys_json = var.deployment_release_manifest_trusted_keys_json
  deployment_terraform_module_source            = var.deployment_terraform_module_source
  deployment_terraform_module_version           = var.deployment_terraform_module_version
}}

output "app_url" {{ value = module.thinkwork.app_url }}
output "app_bucket_name" {{ value = module.thinkwork.app_bucket_name }}
output "app_distribution_id" {{ value = module.thinkwork.app_distribution_id }}
output "api_endpoint" {{ value = module.thinkwork.api_endpoint }}
output "appsync_api_url" {{ value = module.thinkwork.appsync_api_url }}
output "appsync_realtime_url" {{ value = module.thinkwork.appsync_realtime_url }}
output "appsync_api_key" {{
  value     = module.thinkwork.appsync_api_key
  sensitive = true
}}
output "auth_domain" {{ value = module.thinkwork.auth_domain }}
output "db_cluster_endpoint" {{ value = module.thinkwork.db_cluster_endpoint }}
output "db_secret_arn" {{ value = module.thinkwork.db_secret_arn }}
output "database_name" {{ value = module.thinkwork.database_name }}
output "user_pool_id" {{ value = module.thinkwork.user_pool_id }}
output "admin_client_id" {{ value = module.thinkwork.admin_client_id }}
  output "docs_bucket_name" {{ value = module.thinkwork.docs_bucket_name }}
  output "docs_distribution_id" {{ value = module.thinkwork.docs_distribution_id }}
  output "docs_distribution_domain" {{ value = module.thinkwork.docs_distribution_domain }}
  output "cognee_enabled" {{ value = module.thinkwork.cognee_enabled }}
output "twenty_provisioned" {{ value = module.thinkwork.twenty_provisioned }}
output "twenty_runtime_enabled" {{ value = module.thinkwork.twenty_runtime_enabled }}
""",
        encoding="utf-8",
    )
    return vars_json


def sync_release_artifacts():
    global RELEASE_EVIDENCE
    manifest_url = os.environ.get("THINKWORK_RELEASE_MANIFEST_URL")
    expected = os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256", "").lower()
    if not manifest_url:
        raise RuntimeError("THINKWORK_RELEASE_MANIFEST_URL is required")
    download(manifest_url, MANIFEST)
    actual = sha256_file(MANIFEST)
    if expected and actual != expected:
        raise RuntimeError(f"Release manifest digest mismatch: expected {expected}, got {actual}")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    canonical_digest = release_manifest_sha256(manifest)
    trust_evidence = enforce_release_manifest_trust(manifest, canonical_digest, manifest_url)
    bundled_paths, bundle_evidence = download_and_extract_artifact_bundles(manifest)
    lambda_prefix = f"releases/{os.environ['THINKWORK_RELEASE_VERSION']}/lambdas"
    static_files = {}
    artifact_evidence = []
    for artifact in manifest.get("artifacts", []):
        if artifact.get("type") not in {"lambda", "static-site"}:
            continue
        destination, digest, source = materialize_release_artifact(artifact, bundled_paths)
        artifact_evidence.append(
            {
                "name": artifact.get("name"),
                "type": artifact.get("type"),
                "fileName": artifact.get("fileName"),
                "sha256": digest,
                "source": source,
            }
        )
        if artifact.get("type") == "lambda":
            run(
                [
                    "aws",
                    "s3",
                    "cp",
                    str(destination),
                    f"s3://{os.environ['THINKWORK_RELEASE_ARTIFACT_BUCKET']}/{lambda_prefix}/{artifact['fileName']}",
                ]
            )
        else:
            static_files[artifact.get("name")] = destination
    RELEASE_EVIDENCE = {
        "manifestSha256": actual,
        "manifestCanonicalSha256": canonical_digest,
        "trust": trust_evidence,
        "bundles": bundle_evidence,
        "artifacts": artifact_evidence,
    }
    return static_files


def write_outputs_to_ssm(outputs_path, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    profile, web_env = runtime_profile(outputs, vars_json)
    mapping = {
        "profile/api-endpoint": "api_endpoint",
        "profile/app-url": "app_url",
        "profile/graphql-http-url": None,
        "profile/appsync-url": "appsync_api_url",
        "profile/appsync-realtime-url": "appsync_realtime_url",
        "profile/appsync-api-key": "appsync_api_key",
        "profile/cognito-domain": None,
        "profile/cognito-user-pool-id": "user_pool_id",
        "profile/cognito-client-id": "admin_client_id",
    }
    for suffix, output_name in mapping.items():
        if output_name:
            value = outputs.get(output_name, {}).get("value")
        elif suffix == "profile/graphql-http-url":
            value = profile.get("graphqlHttpUrl")
        elif suffix == "profile/cognito-domain":
            value = profile.get("cognitoDomain")
        else:
            value = None
        if value:
            run(
                [
                    "aws",
                    "ssm",
                    "put-parameter",
                    "--overwrite",
                    "--type",
                    "String",
                    "--name",
                    f"{os.environ['THINKWORK_SSM_PREFIX']}/{suffix}",
                    "--value",
                    str(value),
                ]
            )

    run(
        [
            "aws",
            "ssm",
            "put-parameter",
            "--overwrite",
            "--type",
            "String",
            "--name",
            f"{os.environ['THINKWORK_SSM_PREFIX']}/profile/json",
            "--value",
            json.dumps(profile, sort_keys=True),
        ]
    )
    run(
        [
            "aws",
            "ssm",
            "put-parameter",
            "--overwrite",
            "--type",
            "String",
            "--name",
            f"{os.environ['THINKWORK_SSM_PREFIX']}/profile/web-env",
            "--value",
            web_env,
        ]
    )


def controller_terraform_module_version(vars_json):
    configured = vars_json.get("deployment_terraform_module_version")
    if configured:
        return configured
    source = vars_json.get("deployment_terraform_module_source") or ""
    if source.startswith("git::") or source.startswith("github.com/"):
        return ""
    return str(vars_json.get("deployment_release_version") or "").removeprefix("v")


def put_controller_parameter(name, value):
    if not value:
        return
    run(
        [
            "aws",
            "ssm",
            "put-parameter",
            "--overwrite",
            "--type",
            "String",
            "--name",
            f"{os.environ['THINKWORK_SSM_PREFIX']}/{name}",
            "--value",
            str(value),
        ]
    )


def write_controller_release_selection_to_ssm(vars_json):
    if not os.environ.get("THINKWORK_SSM_PREFIX"):
        return {}
    selected = {
        "selected-release-version": vars_json.get("deployment_release_version"),
        "selected-release-manifest-url": vars_json.get("deployment_release_manifest_url"),
        "selected-release-manifest-sha256": vars_json.get("deployment_release_manifest_sha256"),
        "selected-release-signature-url": vars_json.get("deployment_release_manifest_signature_url"),
        "selected-release-trust-policy": vars_json.get("deployment_release_manifest_trust_policy"),
        "selected-release-trusted-keys-json": vars_json.get(
            "deployment_release_manifest_trusted_keys_json"
        ),
        "terraform-module-source": vars_json.get("deployment_terraform_module_source"),
        "terraform-module-version": controller_terraform_module_version(vars_json),
    }
    for name, value in selected.items():
        put_controller_parameter(name, value)
    return {name: value for name, value in selected.items() if value}


def runtime_profile(outputs, vars_json):
    def output_value(name):
        return outputs.get(name, {}).get("value")

    api_endpoint = output_value("api_endpoint") or ""
    app_url = output_value("app_url") or ""
    region = vars_json["region"]
    auth_domain = output_value("auth_domain") or ""
    cognito_domain = (
        auth_domain
        if auth_domain.startswith("https://")
        else f"https://{auth_domain}.auth.{region}.amazoncognito.com"
        if auth_domain
        else ""
    )
    graphql_http_url = f"{api_endpoint.rstrip('/')}/graphql" if api_endpoint else ""
    profile = {
        "stage": vars_json["stage"],
        "region": region,
        "accountId": vars_json["account_id"],
        "releaseVersion": os.environ.get("THINKWORK_RELEASE_VERSION"),
        "releaseManifestUrl": os.environ.get("THINKWORK_RELEASE_MANIFEST_URL"),
        "releaseManifestSha256": os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256"),
        "deploymentId": f"thinkwork-{vars_json['stage']}",
        "displayName": "ThinkWork",
        "appUrl": app_url,
        "apiEndpoint": api_endpoint,
        "graphqlHttpUrl": graphql_http_url,
        "appsyncUrl": output_value("appsync_api_url"),
        "appsyncRealtimeUrl": output_value("appsync_realtime_url"),
        "appsyncApiKey": output_value("appsync_api_key"),
        "cognitoDomain": cognito_domain,
        "cognitoUserPoolId": output_value("user_pool_id"),
        "cognitoClientId": output_value("admin_client_id"),
        "controller": {
            "stateMachineArn": output_value("deployment_state_machine_arn")
            or os.environ.get("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN"),
            "stateMachineName": output_value("deployment_state_machine_name")
            or os.environ.get("THINKWORK_DEPLOYMENT_STATE_MACHINE_NAME"),
            "codebuildProjectName": output_value("deployment_runner_project_name")
            or os.environ.get("THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME"),
            "codebuildProjectArn": output_value("deployment_runner_project_arn")
            or os.environ.get("THINKWORK_DEPLOYMENT_RUNNER_PROJECT_ARN"),
            "evidenceBucketName": output_value("deployment_evidence_bucket_name")
            or os.environ.get("THINKWORK_EVIDENCE_BUCKET"),
            "ssmPrefix": output_value("deployment_ssm_prefix")
            or os.environ.get("THINKWORK_SSM_PREFIX"),
            "appconfigApplicationId": output_value("deployment_appconfig_application_id"),
            "appconfigEnvironmentId": output_value("deployment_appconfig_environment_id"),
            "appconfigConfigurationProfileId": output_value(
                "deployment_appconfig_configuration_profile_id"
            ),
            "verifiedAt": datetime.now(UTC).isoformat(),
        },
        "issuedAt": datetime.now(UTC).isoformat(),
    }
    vite_env = {
        "VITE_API_URL": profile["apiEndpoint"],
        "VITE_GRAPHQL_HTTP_URL": profile["graphqlHttpUrl"],
        "VITE_GRAPHQL_URL": profile["appsyncUrl"],
        "VITE_GRAPHQL_WS_URL": profile["appsyncRealtimeUrl"],
        "VITE_GRAPHQL_API_KEY": profile["appsyncApiKey"],
        "VITE_COGNITO_DOMAIN": profile["cognitoDomain"],
        "VITE_COGNITO_USER_POOL_ID": profile["cognitoUserPoolId"],
        "VITE_COGNITO_CLIENT_ID": profile["cognitoClientId"],
        "VITE_DEPLOYMENT_ID": profile["deploymentId"],
        "VITE_DEPLOYMENT_DISPLAY_NAME": profile["displayName"],
        "VITE_DEPLOYMENT_PROFILE_ISSUED_AT": profile["issuedAt"],
        "VITE_SPACES_URL": profile["appUrl"],
        "VITE_STAGE": profile["stage"],
        "VITE_AWS_REGION": profile["region"],
        "VITE_AWS_ACCOUNT_ID": profile["accountId"],
        "VITE_RELEASE_VERSION": profile["releaseVersion"],
        "VITE_RELEASE_MANIFEST_URL": profile["releaseManifestUrl"],
        "VITE_RELEASE_MANIFEST_SHA256": profile["releaseManifestSha256"],
        "VITE_DEPLOYMENT_CONTROLLER_ARN": profile["controller"]["stateMachineArn"],
        "VITE_DEPLOYMENT_CONTROLLER_NAME": profile["controller"]["stateMachineName"],
        "VITE_DEPLOYMENT_RUNNER_PROJECT_NAME": profile["controller"]["codebuildProjectName"],
        "VITE_DEPLOYMENT_RUNNER_PROJECT_ARN": profile["controller"]["codebuildProjectArn"],
        "VITE_DEPLOYMENT_EVIDENCE_BUCKET": profile["controller"]["evidenceBucketName"],
        "VITE_DEPLOYMENT_SSM_PREFIX": profile["controller"]["ssmPrefix"],
    }
    profile["viteEnv"] = vite_env
    web_env = "\n".join(f"{key}={value or ''}" for key, value in sorted(vite_env.items()))
    return profile, web_env + "\n"


def sync_static(outputs_path, static_files, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    syncs = [
        ("web", "app_bucket_name", "app_distribution_id"),
        ("docs", "docs_bucket_name", "docs_distribution_id"),
    ]
    for artifact_name, bucket_output, distribution_output in syncs:
        archive = static_files.get(artifact_name)
        bucket = outputs.get(bucket_output, {}).get("value")
        if not archive or not bucket:
            continue
        target = RELEASE / f"extract-{artifact_name}"
        target.mkdir(parents=True, exist_ok=True)
        safe_extract_tar_file(archive, target)
        run(["aws", "s3", "sync", "--delete", str(target), f"s3://{bucket}/"])
        if artifact_name == "web":
            index_path = target / "index.html"
            if index_path.exists():
                run(
                    [
                        "aws",
                        "s3",
                        "cp",
                        str(index_path),
                        f"s3://{bucket}/index.html",
                        "--content-type",
                        "text/html",
                        "--cache-control",
                        "no-store",
                    ]
                )
            profile, _ = runtime_profile(outputs, vars_json)
            runtime_config_path = RELEASE / "thinkwork-runtime-config.json"
            runtime_config_path.write_text(
                json.dumps(profile, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            run(
                [
                    "aws",
                    "s3",
                    "cp",
                    str(runtime_config_path),
                    f"s3://{bucket}/thinkwork-runtime-config.json",
                    "--content-type",
                    "application/json",
                    "--cache-control",
                    "no-store",
                ]
            )
        distribution_id = outputs.get(distribution_output, {}).get("value")
        if distribution_id:
            run(
                [
                    "aws",
                    "cloudfront",
                    "create-invalidation",
                    "--distribution-id",
                    str(distribution_id),
                    "--paths",
                    "/*",
                ]
            )


def write_evidence(status, vars_json=None, terraform_exit_code=None, error=None):
    vars_json = vars_json or {}
    evidence = {
        "status": status,
        "stage": os.environ.get("THINKWORK_STAGE"),
        "release": os.environ.get("THINKWORK_RELEASE_VERSION"),
        "action": os.environ.get("THINKWORK_DEPLOYMENT_ACTION"),
        "sessionId": os.environ.get("THINKWORK_DEPLOYMENT_SESSION_ID"),
        "environmentName": vars_json.get("stage"),
        "awsAccountId": vars_json.get("account_id"),
        "awsRegion": vars_json.get("region"),
        "managedApps": {"cognee": False, "twenty": False},
        "codebuildBuildId": os.environ.get("CODEBUILD_BUILD_ID"),
        "terraformExitCode": terraform_exit_code,
        "startedAt": STARTED_AT,
        "recordedAt": datetime.now(UTC).isoformat(),
    }
    if error:
        evidence["error"] = str(error)
    if RELEASE_EVIDENCE:
        evidence["releaseArtifacts"] = RELEASE_EVIDENCE
    if CONTROLLER_EVIDENCE:
        evidence["controller"] = CONTROLLER_EVIDENCE
    if TERRAFORM_EVIDENCE:
        evidence["terraform"] = TERRAFORM_EVIDENCE
    Path("deployment-evidence.json").write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    prefix = os.environ.get("THINKWORK_EVIDENCE_PREFIX")
    bucket = os.environ.get("THINKWORK_EVIDENCE_BUCKET")
    if prefix and bucket:
        run(
            [
                "aws",
                "s3",
                "cp",
                "deployment-evidence.json",
                f"s3://{bucket}/{prefix}/deployment-evidence.json",
            ]
        )


def main():
    global CONTROLLER_EVIDENCE, TERRAFORM_EVIDENCE
    WORK.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("CLOUDFLARE_API_TOKEN", "placeholder-not-configured")
    payload = read_json_env("THINKWORK_DEPLOYMENT_INPUT", {})
    apply_release_selection(payload)
    action = os.environ.get("THINKWORK_DEPLOYMENT_ACTION") or payload.get("action") or "deploy"
    if action == "teardown":
        action = "destroy"
    if action not in {"deploy", "update", "destroy", "plan", "status"}:
        raise RuntimeError(f"Unsupported deployment action: {action}")
    os.environ["THINKWORK_DEPLOYMENT_ACTION"] = action

    if action == "status":
        CONTROLLER_EVIDENCE = {
            "status": write_controller_status_evidence(payload),
        }
        write_evidence(
            "succeeded",
            {
                "stage": safe_get(payload, "stage", "environmentName", default=""),
                "account_id": safe_get(payload, "awsAccountId", "accountId", default=""),
                "region": safe_get(payload, "awsRegion", "region", default=""),
            },
            0,
        )
        return 0

    runner_secrets = secret_payload(payload)
    static_files = sync_release_artifacts() if action in {"deploy", "update"} else {}
    vars_json = write_runner_files(payload, runner_secrets)
    controller_summary = controller_input_summary(payload)
    CONTROLLER_EVIDENCE = {
        "inputSummary": controller_summary,
        "artifact": write_json_evidence_artifact(
            "controller-input-summary.json",
            controller_summary,
        ),
    }
    TERRAFORM_EVIDENCE = {
        "redactedVariables": write_json_evidence_artifact(
            "redacted-terraform-vars.json",
            redacted_tfvars(vars_json),
        )
    }
    write_evidence("running", vars_json)

    run(["terraform", "init", "-backend-config=backend.hcl", "-no-color"], cwd=TF)
    workspace = vars_json["stage"]
    selected = subprocess.run(
        ["terraform", "workspace", "select", workspace, "-no-color"],
        cwd=TF,
        text=True,
    )
    if selected.returncode != 0:
        run(["terraform", "workspace", "new", workspace, "-no-color"], cwd=TF)
    if action == "destroy":
        plan = subprocess.run(
            ["terraform", "plan", "-destroy", "-out=tfplan", "-no-color"],
            cwd=TF,
            text=True,
        )
        if plan.returncode == 0:
            TERRAFORM_EVIDENCE["plan"] = write_terraform_plan_evidence()
            result = subprocess.run(
                ["terraform", "apply", "-auto-approve", "-no-color", "tfplan"],
                cwd=TF,
                text=True,
            )
        else:
            result = plan
    else:
        plan = subprocess.run(
            ["terraform", "plan", "-out=tfplan", "-no-color"],
            cwd=TF,
            text=True,
        )
        if plan.returncode == 0:
            TERRAFORM_EVIDENCE["plan"] = write_terraform_plan_evidence()
        if action == "plan" or plan.returncode != 0:
            result = plan
        else:
            result = subprocess.run(
                ["terraform", "apply", "-auto-approve", "-no-color", "tfplan"],
                cwd=TF,
                text=True,
            )

    outputs_path = TF / "outputs.json"
    if result.returncode == 0 and action in {"deploy", "update"}:
        outputs_path.write_text(output(["terraform", "output", "-json"], cwd=TF), encoding="utf-8")
        TERRAFORM_EVIDENCE["outputs"] = {
            "fileName": "terraform-outputs.json",
            "sha256": sha256_file(outputs_path),
            "s3Uri": upload_evidence_artifact(outputs_path, "terraform-outputs.json"),
        }
        push_database_schema(outputs_path, vars_json)
        write_outputs_to_ssm(outputs_path, vars_json)
        selected_controller_release = write_controller_release_selection_to_ssm(vars_json)
        if selected_controller_release:
            CONTROLLER_EVIDENCE["releaseSelection"] = write_json_evidence_artifact(
                "controller-release-selection.json",
                selected_controller_release,
            )
        sync_static(outputs_path, static_files, vars_json)
    write_evidence(
        "succeeded" if result.returncode == 0 else "failed",
        vars_json,
        result.returncode,
    )
    return result.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        write_evidence("failed", error=exc)
        raise
