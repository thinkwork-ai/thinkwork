import base64
import hashlib
import json
import os
import platform
import re
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
DEFAULT_PLANE_AIO_IMAGE_URI = (
    "artifacts.plane.so/makeplane/plane-aio-commercial:stable@sha256:"
    "7385b873e58f8325e68950689ae003ce1cb8d017f49011ab4b3f1ad9e6e958db"
)
CLOUDFLARE_PROVIDER_VERSION = "4.52.7"
CLOUDFLARE_PROVIDER_LINUX_AMD64_SHA256 = (
    "904acc31ebb9d6ef68c792074b30532ee61bf515f19e0a3c75b46f126cca1f13"
)
CLOUDFLARE_PROVIDER_LINUX_AMD64_URL = (
    "https://github.com/cloudflare/terraform-provider-cloudflare/releases/download/"
    f"v{CLOUDFLARE_PROVIDER_VERSION}/"
    f"terraform-provider-cloudflare_{CLOUDFLARE_PROVIDER_VERSION}_linux_amd64.zip"
)
STARTED_AT = datetime.now(UTC).isoformat()
RELEASE_EVIDENCE = {}
CONTROLLER_EVIDENCE = {}
TERRAFORM_EVIDENCE = {}
FIRST_ADMIN_EVIDENCE = {}
RELEASE_MANIFEST_TRUST_POLICIES = {
    "allow_unsigned_canary",
    "require_signature",
}
# Migrations that intentionally re-run after seed data lands (idempotent;
# they backfill from seeded rows). Everything else is ledger-driven.
POST_SEED_MIGRATIONS = [
    "0155_tenant_model_catalog.sql",
]
MIGRATION_MARKER_KINDS = [
    ("-- creates-column:", "column"),
    ("-- creates-constraint:", "constraint"),
    ("-- creates:", "object"),
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


def configure_terraform_provider_mirror():
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system != "linux" or machine not in {"x86_64", "amd64"}:
        return

    mirror = WORK / "provider-mirror"
    package = (
        mirror
        / "registry.terraform.io"
        / "cloudflare"
        / "cloudflare"
        / f"terraform-provider-cloudflare_{CLOUDFLARE_PROVIDER_VERSION}_linux_amd64.zip"
    )
    if not package.exists() or sha256_file(package) != CLOUDFLARE_PROVIDER_LINUX_AMD64_SHA256:
        download(CLOUDFLARE_PROVIDER_LINUX_AMD64_URL, package)

    digest = sha256_file(package)
    if digest != CLOUDFLARE_PROVIDER_LINUX_AMD64_SHA256:
        raise RuntimeError(
            "Cloudflare provider mirror digest mismatch: "
            f"expected {CLOUDFLARE_PROVIDER_LINUX_AMD64_SHA256}, got {digest}"
        )

    terraformrc = WORK / "terraformrc"
    terraformrc.write_text(
        f"""
provider_installation {{
  filesystem_mirror {{
    path    = "{mirror}"
    include = ["registry.terraform.io/cloudflare/cloudflare"]
  }}
  direct {{
    exclude = ["registry.terraform.io/cloudflare/cloudflare"]
  }}
}}
""".lstrip(),
        encoding="utf-8",
    )
    os.environ["TF_CLI_CONFIG_FILE"] = str(terraformrc)


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
        "microsoft_oauth_client_secret",
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


def managed_app_terraform_target_args(payload):
    if payload.get("appKey") != "plane":
        return []
    return [
        "-target=module.thinkwork.terraform_data.plane_configuration_guardrails",
        "-target=module.thinkwork.module.plane",
        "-target=cloudflare_record.plane",
    ]


def truthy(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def managed_app_state_isolation_enabled(payload):
    features = payload.get("features")
    if isinstance(features, dict) and truthy(features.get("managedAppStateIsolation")):
        return True
    contract = payload.get("operationContract")
    if isinstance(contract, dict) and truthy(contract.get("managedAppStateIsolation")):
        return True
    return truthy(os.environ.get("THINKWORK_MANAGED_APP_STATE_ISOLATION"))


def managed_app_backend_app_key(payload):
    app_key = str(payload.get("appKey") or "").strip().lower()
    if not app_key:
        raise RuntimeError("Managed app state isolation requires appKey.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", app_key):
        raise RuntimeError(f"Invalid managed app key for Terraform state: {app_key!r}")
    return app_key


def terraform_backend_key(stage, payload):
    if is_managed_app_operation(payload) and managed_app_state_isolation_enabled(payload):
        app_key = managed_app_backend_app_key(payload)
        return f"thinkwork/{stage}/managed-apps/{app_key}/terraform.tfstate"
    return f"thinkwork/{stage}/terraform.tfstate"


def terraform_workspace_name(stage, payload):
    if is_managed_app_operation(payload) and managed_app_state_isolation_enabled(payload):
        # Per-app backend keys already include the stage. Staying on the
        # default workspace keeps the S3 object key exact and gives each app a
        # separate lock row instead of env:/<stage>/... workspace indirection.
        return "default"
    return stage


def refresh_outputs_after_targeted_apply(payload):
    if not is_managed_app_operation(payload):
        return
    print("[runner] refreshing Terraform outputs after targeted managed-app apply")
    run(
        [
            "terraform",
            "apply",
            "-refresh-only",
            "-auto-approve",
            "-no-color",
        ],
        cwd=TF,
    )


def is_managed_app_operation(payload):
    contract = payload.get("operationContract")
    if isinstance(contract, dict) and contract.get("kind") == "managed_app":
        return True
    return bool(payload.get("appKey"))


def is_web_only_operation(payload, action=None):
    if action == "web":
        return True
    operation = payload.get("operation")
    if isinstance(operation, dict):
        kind = str(operation.get("kind") or "").strip().lower()
        if kind in {"web", "web-only", "web_only", "static-web"}:
            return True
    component = str(payload.get("component") or "").strip().lower()
    return component == "web" or truthy(payload.get("webOnly"))


def configure_managed_app_evidence_prefix(payload):
    if not is_managed_app_operation(payload):
        return
    os.environ["THINKWORK_MANAGED_APP_OPERATION"] = "true"
    evidence = payload.get("evidence")
    if isinstance(evidence, dict):
        prefix = evidence.get("prefix")
        if isinstance(prefix, str) and prefix:
            os.environ["THINKWORK_EVIDENCE_PREFIX"] = prefix


def validate_managed_app_plan_scope(payload, plan_json):
    if payload.get("appKey") != "plane":
        return
    unsafe_changes = []
    for change in plan_json.get("resource_changes", []):
        actions = change.get("change", {}).get("actions", [])
        if not actions or actions == ["no-op"] or actions == ["read"]:
            continue
        address = change.get("address", "")
        if address.startswith("module.thinkwork.module.plane"):
            continue
        if address.startswith("module.thinkwork.terraform_data.plane_configuration_guardrails"):
            continue
        if address.startswith("cloudflare_record.plane"):
            continue
        unsafe_changes.append(
            {
                "address": address,
                "actions": actions,
            }
        )
    if unsafe_changes:
        preview = ", ".join(
            f"{item['address']}:{'/'.join(item['actions'])}" for item in unsafe_changes[:10]
        )
        raise RuntimeError(
            "Managed app plan for Plane contains non-Plane changes; refusing to continue. "
            f"Examples: {preview}"
        )


def destructive_plan_actions(actions):
    return "delete" in (actions or [])


def allow_customer_domain_removal(payload):
    return safe_get_bool({}, payload or {}, "allowCustomerDomainRemoval", default=False)


def validate_environment_plan_scope(payload, plan_json):
    if is_managed_app_operation(payload):
        return
    if allow_customer_domain_removal(payload):
        return

    unsafe_changes = []
    for change in plan_json.get("resource_changes", []):
        actions = change.get("change", {}).get("actions", [])
        if not actions or actions == ["no-op"] or actions == ["read"]:
            continue
        address = change.get("address", "")
        before = change.get("change", {}).get("before") or {}
        after = change.get("change", {}).get("after") or {}

        if address.startswith("module.thinkwork.module.customer_domain.") and destructive_plan_actions(actions):
            unsafe_changes.append({"address": address, "actions": actions})
            continue

        if (
            address.startswith("module.thinkwork.module.computer_site.aws_cloudfront_distribution.")
            and "update" in actions
            and customer_domain_cloudfront_alias_removed(before, after)
        ):
            unsafe_changes.append({"address": address, "actions": actions})

    if unsafe_changes:
        preview = ", ".join(
            f"{item['address']}:{'/'.join(item['actions'])}" for item in unsafe_changes[:10]
        )
        raise RuntimeError(
            "Terraform plan would remove customer-domain web resources; refusing to continue. "
            "Preserve customerDomain/customerDomainDelegated in the controller input or runner "
            "secret. Set allowCustomerDomainRemoval=true only for an intentional, reviewed "
            f"domain-retirement operation. Examples: {preview}"
        )


def customer_domain_cloudfront_alias_removed(before, after):
    before_aliases = set(cloudfront_alias_items(before.get("aliases")))
    after_aliases = set(cloudfront_alias_items(after.get("aliases")))
    if before_aliases and not after_aliases:
        return True
    return bool(before_aliases - after_aliases)


def cloudfront_alias_items(value):
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, dict):
        items = value.get("items") or value.get("Items")
        if isinstance(items, list):
            return [str(item) for item in items if item]
    return []


def write_terraform_plan_evidence(payload=None):
    plan_path = Path("terraform-plan.json")
    with plan_path.open("w", encoding="utf-8") as handle:
        run(["terraform", "show", "-json", "tfplan"], cwd=TF, stdout=handle)
    plan_json = json.loads(plan_path.read_text(encoding="utf-8"))
    validate_managed_app_plan_scope(payload or {}, plan_json)
    validate_environment_plan_scope(payload or {}, plan_json)
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


def safe_get_bool(runner_secrets, payload, name, default=False):
    """Boolean analogue of the safe_get(runner_secrets, default=safe_get(payload))
    precedence. Controller payloads carry real JSON booleans, but Secrets
    Manager JSON values frequently arrive as strings ("true"). Generated-root
    variables typed `bool` reject strings, so boolean wiring points must
    round-trip through this helper and always emit real booleans.
    """
    for source in (runner_secrets, payload):
        value = source.get(name)
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value:
            return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def current_terraform_state(stage):
    bucket = os.environ.get("THINKWORK_TERRAFORM_STATE_BUCKET")
    if not bucket:
        return {}
    keys = [
        f"env:/{stage}/thinkwork/{stage}/terraform.tfstate",
        f"thinkwork/{stage}/terraform.tfstate",
    ]
    for key in keys:
        try:
            body = output(["aws", "s3", "cp", f"s3://{bucket}/{key}", "-"])
            state = json.loads(body)
            if isinstance(state, dict):
                return state
        except Exception:
            continue
    return {}


def current_terraform_outputs(stage):
    outputs = current_terraform_state(stage).get("outputs")
    return outputs if isinstance(outputs, dict) else {}


def cloudflare_api_token(stage):
    existing = os.environ.get("CLOUDFLARE_API_TOKEN")
    if existing:
        return existing
    parameter_name = f"/thinkwork/{stage}/cloudflare-namespace-token"
    try:
        token = output(
            [
                "aws",
                "ssm",
                "get-parameter",
                "--name",
                parameter_name,
                "--with-decryption",
                "--query",
                "Parameter.Value",
                "--output",
                "text",
            ]
        )
    except Exception:
        return ""
    if token:
        os.environ["CLOUDFLARE_API_TOKEN"] = token
    return token


def configure_cloudflare_provider_auth(stage):
    cloudflare_api_token(stage)


def cloudflare_zone_id_for_hostname(stage, hostname):
    configured = os.environ.get("THINKWORK_CLOUDFLARE_ZONE_ID", "")
    if configured:
        return configured
    hostname = (hostname or "").strip().lower().rstrip(".")
    if not hostname:
        return ""
    token = cloudflare_api_token(stage)
    if not token:
        return ""
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/zones?per_page=50",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except Exception:
        return ""
    zones = body.get("result")
    if not isinstance(zones, list):
        return ""
    matches = []
    for zone in zones:
        if not isinstance(zone, dict):
            continue
        name = str(zone.get("name") or "").strip().lower().rstrip(".")
        zone_id = str(zone.get("id") or "").strip()
        if not name or not zone_id:
            continue
        if hostname == name or hostname.endswith(f".{name}"):
            matches.append((len(name), zone_id))
    if not matches:
        return ""
    return sorted(matches, reverse=True)[0][1]


def state_output(outputs, name, default=None):
    value = outputs.get(name)
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return default


def string_state_output(outputs, name):
    value = state_output(outputs, name, "")
    return value.strip() if isinstance(value, str) else ""


def bool_state_output(outputs, name):
    return bool(state_output(outputs, name, False))


def enforce_customer_domain_preservation(current_outputs, vars_json, payload, runner_secrets):
    previous_domain = string_state_output(current_outputs, "customer_domain")
    if not previous_domain:
        return

    allow_removal = safe_get_bool(
        runner_secrets,
        payload,
        "allowCustomerDomainRemoval",
        default=False,
    )
    next_domain = str(vars_json.get("customer_domain") or "").strip()
    if not next_domain:
        if allow_removal:
            return
        raise RuntimeError(
            "Refusing to clear customer_domain during a controller update. "
            f"Current Terraform state has customer_domain={previous_domain!r}, "
            "but this run generated an empty customer_domain. Preserve "
            "customerDomain/customerDomainDelegated/customerDomainLegacyRetired "
            "in the controller payload or runner secret. Set "
            "allowCustomerDomainRemoval=true only for an intentional, reviewed "
            "domain-retirement operation."
        )

    if next_domain != previous_domain and not allow_removal:
        raise RuntimeError(
            "Refusing to change customer_domain during a controller update. "
            f"Current Terraform state has {previous_domain!r}, but this run "
            f"generated {next_domain!r}. Domain changes require an explicit, "
            "reviewed domain migration with allowCustomerDomainRemoval=true."
        )

    previous_delegated = bool_state_output(current_outputs, "customer_domain_delegated")
    next_delegated = bool(vars_json.get("customer_domain_delegated", False))
    if previous_delegated and not next_delegated and not allow_removal:
        raise RuntimeError(
            "Refusing to turn off customer_domain_delegated during a controller "
            f"update for {previous_domain!r}. Disabling delegation would remove "
            "customer-domain CloudFront aliases and Cognito callbacks. Use an "
            "explicit reviewed domain-retirement operation if this is intended."
        )


def state_terraform_data_input(state, name):
    for resource in state.get("resources", []) or []:
        if resource.get("type") != "terraform_data" or resource.get("name") != name:
            continue
        for instance in resource.get("instances", []) or []:
            attributes = instance.get("attributes") or {}
            terraform_input = attributes.get("input")
            if isinstance(terraform_input, dict):
                value = terraform_input.get("value")
                if isinstance(value, dict):
                    return value
                return terraform_input
    return {}


def state_cloudflare_zone_id(state):
    for resource in state.get("resources", []) or []:
        if resource.get("type") != "cloudflare_record":
            continue
        for instance in resource.get("instances", []) or []:
            attributes = instance.get("attributes") or {}
            zone_id = attributes.get("zone_id")
            if isinstance(zone_id, str) and zone_id:
                return zone_id
    return os.environ.get("THINKWORK_CLOUDFLARE_ZONE_ID", "")


def url_hostname(url):
    try:
        return urllib.parse.urlparse(url).hostname or ""
    except Exception:
        return ""


def config_value(desired_config, manifest_images, key, env_name, image_names=None, default=""):
    value = desired_config.get(key)
    if isinstance(value, str) and value:
        return value
    for image_name in image_names or []:
        image = manifest_images.get(image_name)
        if isinstance(image, str) and image:
            return image
    return os.environ.get(env_name, default)


def validate_managed_app_desired_state(payload, desired_config, manifest_images):
    app_key = payload.get("appKey")
    if not app_key:
        return
    operation = str(payload.get("operation") or "").upper()
    if operation not in {"ENABLE", "PARK", "DESTROY", "UPGRADE"}:
        raise RuntimeError(
            "Managed app operation requires operation to be one of "
            "ENABLE, PARK, DESTROY, or UPGRADE."
        )
    if operation == "DESTROY" or app_key != "plane":
        return

    required = [
        (
            "mcpImageUri",
            "THINKWORK_PLANE_MCP_IMAGE_URI",
            ["plane-mcp-server", "plane-mcp"],
        ),
        ("dbUrlSecretArn", "THINKWORK_PLANE_DB_URL_SECRET_ARN", []),
        ("secretKeySecretArn", "THINKWORK_PLANE_SECRET_KEY_SECRET_ARN", []),
        (
            "liveServerSecretKeySecretArn",
            "THINKWORK_PLANE_LIVE_SERVER_SECRET_KEY_SECRET_ARN",
            [],
        ),
        ("aesSecretKeySecretArn", "THINKWORK_PLANE_AES_SECRET_KEY_SECRET_ARN", []),
        ("publicUrl", "THINKWORK_PLANE_PUBLIC_URL", []),
        ("certificateArn", "THINKWORK_PLANE_CERTIFICATE_ARN", []),
    ]
    missing = [
        key
        for key, env_name, image_names in required
        if not config_value(desired_config, manifest_images, key, env_name, image_names)
    ]
    if missing:
        raise RuntimeError(
            "Plane managed app operation is missing required desired-state fields: "
            + ", ".join(missing)
        )


def managed_app_terraform_overrides(payload, stage, account_id, current_outputs, current_state):
    app_key = payload.get("appKey")
    operation = str(payload.get("operation") or "").upper()
    desired_config = payload.get("desiredConfig")
    if not isinstance(desired_config, dict):
        desired_config = {}
    manifest_images = payload.get("manifestImages")
    if not isinstance(manifest_images, dict):
        manifest_images = {}
    validate_managed_app_desired_state(payload, desired_config, manifest_images)
    cognee_guardrails = state_terraform_data_input(
        current_state,
        "cognee_configuration_guardrails",
    )
    twenty_guardrails = state_terraform_data_input(
        current_state,
        "twenty_configuration_guardrails",
    )

    overrides = {
        "enable_cognee": bool(state_output(current_outputs, "cognee_enabled", False)),
        "cognee_image_uri": cognee_guardrails.get("cognee_image_uri", ""),
        "cognee_db_username": cognee_guardrails.get("cognee_db_username", "thinkwork_cognee"),
        "cognee_db_name": cognee_guardrails.get("cognee_db_name", "thinkwork_cognee"),
        "cognee_db_password_secret_arn": cognee_guardrails.get(
            "cognee_db_password_secret_arn",
            "",
        ),
        "cognee_backend_mode": cognee_guardrails.get("cognee_backend_mode", "dogfood"),
        "cognee_desired_count": cognee_guardrails.get("cognee_desired_count", 1),
        "cognee_brain_tenant_id": state_output(current_outputs, "cognee_brain_tenant_id", ""),
        "cognee_brain_instance_key": state_output(
            current_outputs,
            "cognee_brain_instance_key",
            "",
        ),
        "cognee_brain_storage_tier": cognee_guardrails.get(
            "cognee_brain_storage_tier",
            state_output(current_outputs, "cognee_brain_storage_tier", "default"),
        ),
        "cognee_brain_s3_artifact_root": state_output(
            current_outputs,
            "cognee_s3_artifact_root",
            "",
        ),
        "cognee_brain_s3_manifest_root": state_output(
            current_outputs,
            "cognee_s3_manifest_root",
            "",
        ),
        "cognee_brain_s3_vault_projection_root": state_output(
            current_outputs,
            "cognee_s3_vault_projection_root",
            "",
        ),
        "cognee_private_substrate_mode": bool(
            state_output(current_outputs, "cognee_private_substrate_mode", True)
        ),
        "cognee_llm_provider": cognee_guardrails.get("cognee_llm_provider", "bedrock"),
        "cognee_llm_model": "bedrock/moonshotai.kimi-k2.5",
        "cognee_embedding_provider": cognee_guardrails.get(
            "cognee_embedding_provider",
            "bedrock",
        ),
        "cognee_embedding_model": state_output(
            current_outputs,
            "cognee_embedding_model",
            "amazon.titan-embed-text-v2:0",
        ),
        "cognee_embedding_dimensions": state_output(
            current_outputs,
            "cognee_embedding_dimensions",
            1024,
        ),
        "cognee_vector_db_provider": state_output(
            current_outputs,
            "cognee_vector_db_provider",
            "lancedb",
        ),
        "cognee_graph_database_provider": state_output(
            current_outputs,
            "cognee_graph_database_provider",
            "kuzu",
        ),
        "cognee_neptune_graph_id": state_output(current_outputs, "cognee_neptune_graph_id", ""),
        "cognee_neptune_endpoint": state_output(current_outputs, "cognee_neptune_endpoint", ""),
        "cognee_production_posture": state_output(
            current_outputs,
            "cognee_production_posture",
            "",
        ),
        "cognee_bedrock_model_resource_arns": cognee_guardrails.get(
            "cognee_bedrock_model_resources",
            [],
        ),
        "twenty_provisioned": bool(state_output(current_outputs, "twenty_provisioned", False)),
        "twenty_runtime_enabled": bool(
            state_output(current_outputs, "twenty_runtime_enabled", False)
        ),
        "twenty_image_uri": twenty_guardrails.get("twenty_image_uri", ""),
        "twenty_db_username": twenty_guardrails.get("twenty_db_username", "thinkwork_twenty"),
        "twenty_db_name": twenty_guardrails.get("twenty_db_name", "thinkwork_twenty"),
        "twenty_db_url_secret_arn": twenty_guardrails.get("twenty_db_url_secret_arn", ""),
        "twenty_encryption_key_secret_arn": twenty_guardrails.get(
            "twenty_encryption_key_secret_arn",
            "",
        ),
        "twenty_email_from_address": "",
        "twenty_email_from_name": "ThinkWork CRM",
        "twenty_public_url": twenty_guardrails.get(
            "twenty_public_url",
            state_output(current_outputs, "twenty_url", ""),
        ),
        "twenty_certificate_arn": twenty_guardrails.get("twenty_certificate_arn", ""),
        "enable_deployment_control_plane": False,
        "deployment_control_plane_create_secret_placeholders": False,
        "cloudflare_zone_id": state_cloudflare_zone_id(current_state),
        "plane_dns_enabled": False,
        "plane_dns_name": "",
        "plane_provisioned": bool(state_output(current_outputs, "plane_provisioned", False)),
        "plane_runtime_enabled": bool(
            state_output(current_outputs, "plane_runtime_enabled", False)
        ),
        "plane_image_uri": "",
        "plane_frontend_image_uri": "",
        "plane_backend_image_uri": "",
        "plane_space_image_uri": "",
        "plane_admin_image_uri": "",
        "plane_live_image_uri": "",
        "plane_mcp_image_uri": "",
        "plane_db_url_secret_arn": "",
        "plane_secret_key_secret_arn": "",
        "plane_live_server_secret_key_secret_arn": "",
        "plane_aes_secret_key_secret_arn": "",
        "plane_s3_access_key_id_secret_arn": "",
        "plane_s3_secret_access_key_secret_arn": "",
        "plane_s3_bucket_name": "",
        "plane_domain": "",
        "plane_public_url": "",
        "plane_certificate_arn": "",
        "plane_web_container_port": 8080,
    }

    if app_key != "plane":
        return overrides

    provisioned = operation != "DESTROY"
    runtime_enabled = provisioned and operation != "PARK"
    default_bucket = f"thinkwork-{stage}-{account_id}-plane"
    overrides.update(
        {
            "plane_provisioned": provisioned,
            "plane_runtime_enabled": runtime_enabled,
            "plane_image_uri": config_value(
                desired_config,
                manifest_images,
                "imageUri",
                "THINKWORK_PLANE_IMAGE_URI",
                ["plane-aio", "plane"],
                default=DEFAULT_PLANE_AIO_IMAGE_URI,
            ),
            "plane_frontend_image_uri": config_value(
                desired_config,
                manifest_images,
                "frontendImageUri",
                "THINKWORK_PLANE_FRONTEND_IMAGE_URI",
                ["plane-frontend", "plane-web"],
            ),
            "plane_backend_image_uri": config_value(
                desired_config,
                manifest_images,
                "backendImageUri",
                "THINKWORK_PLANE_BACKEND_IMAGE_URI",
                ["plane-backend", "plane-api"],
            ),
            "plane_space_image_uri": config_value(
                desired_config,
                manifest_images,
                "spaceImageUri",
                "THINKWORK_PLANE_SPACE_IMAGE_URI",
                ["plane-space"],
            ),
            "plane_admin_image_uri": config_value(
                desired_config,
                manifest_images,
                "adminImageUri",
                "THINKWORK_PLANE_ADMIN_IMAGE_URI",
                ["plane-admin"],
            ),
            "plane_live_image_uri": config_value(
                desired_config,
                manifest_images,
                "liveImageUri",
                "THINKWORK_PLANE_LIVE_IMAGE_URI",
                ["plane-live"],
            ),
            "plane_mcp_image_uri": config_value(
                desired_config,
                manifest_images,
                "mcpImageUri",
                "THINKWORK_PLANE_MCP_IMAGE_URI",
                ["plane-mcp-server", "plane-mcp"],
            ),
            "plane_db_url_secret_arn": config_value(
                desired_config,
                manifest_images,
                "dbUrlSecretArn",
                "THINKWORK_PLANE_DB_URL_SECRET_ARN",
            ),
            "plane_secret_key_secret_arn": config_value(
                desired_config,
                manifest_images,
                "secretKeySecretArn",
                "THINKWORK_PLANE_SECRET_KEY_SECRET_ARN",
            ),
            "plane_live_server_secret_key_secret_arn": config_value(
                desired_config,
                manifest_images,
                "liveServerSecretKeySecretArn",
                "THINKWORK_PLANE_LIVE_SERVER_SECRET_KEY_SECRET_ARN",
            ),
            "plane_aes_secret_key_secret_arn": config_value(
                desired_config,
                manifest_images,
                "aesSecretKeySecretArn",
                "THINKWORK_PLANE_AES_SECRET_KEY_SECRET_ARN",
            ),
            "plane_s3_access_key_id_secret_arn": config_value(
                desired_config,
                manifest_images,
                "s3AccessKeyIdSecretArn",
                "THINKWORK_PLANE_S3_ACCESS_KEY_ID_SECRET_ARN",
            ),
            "plane_s3_secret_access_key_secret_arn": config_value(
                desired_config,
                manifest_images,
                "s3SecretAccessKeySecretArn",
                "THINKWORK_PLANE_S3_SECRET_ACCESS_KEY_SECRET_ARN",
            ),
            "plane_s3_bucket_name": config_value(
                desired_config,
                manifest_images,
                "s3BucketName",
                "THINKWORK_PLANE_S3_BUCKET_NAME",
                default=default_bucket,
            ),
            "plane_domain": config_value(
                desired_config,
                manifest_images,
                "domain",
                "THINKWORK_PLANE_DOMAIN",
            ),
            "plane_public_url": config_value(
                desired_config,
                manifest_images,
                "publicUrl",
                "THINKWORK_PLANE_PUBLIC_URL",
            ),
            "plane_certificate_arn": config_value(
                desired_config,
                manifest_images,
                "certificateArn",
                "THINKWORK_PLANE_CERTIFICATE_ARN",
            ),
            "plane_web_container_port": int(
                desired_config.get("webContainerPort")
                or desired_config.get("listenHttpPort")
                or os.environ.get("THINKWORK_PLANE_WEB_CONTAINER_PORT", "8080")
            ),
            "deployment_control_plane_create_secret_placeholders": True,
        }
    )
    plane_dns_name = overrides["plane_domain"] or url_hostname(overrides["plane_public_url"])
    overrides["cloudflare_zone_id"] = overrides[
        "cloudflare_zone_id"
    ] or cloudflare_zone_id_for_hostname(stage, plane_dns_name)
    overrides["plane_dns_name"] = plane_dns_name
    overrides["plane_dns_enabled"] = (
        provisioned and bool(overrides["cloudflare_zone_id"]) and bool(plane_dns_name)
    )
    return overrides


def existing_stage_secret_string(stage, suffix):
    """Read a plain-string platform secret (e.g. thinkwork/<stage>/api-auth).

    Returns "" when the secret does not exist yet (first install) or cannot
    be read — callers mint a fresh value in that case.
    """
    try:
        body = output(
            [
                "aws",
                "secretsmanager",
                "get-secret-value",
                "--secret-id",
                f"thinkwork/{stage}/{suffix}",
                "--query",
                "SecretString",
                "--output",
                "text",
            ]
        )
        return body.strip() if isinstance(body, str) else ""
    except Exception:
        return ""


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


def ensure_release_manifest_available(manifest_url, manifest_sha256):
    if MANIFEST.exists() or not manifest_url:
        return
    download(manifest_url, MANIFEST)
    actual = sha256_file(MANIFEST)
    expected = (manifest_sha256 or "").lower()
    if expected and actual != expected:
        raise RuntimeError(f"Release manifest digest mismatch: expected {expected}, got {actual}")


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
    if module_source.startswith("git::") or ".git//" in source_path:
        return module_source, ""
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


def migration_files():
    migrations = SOURCE / "packages/database-pg/drizzle"
    return sorted(path for path in migrations.glob("*.sql") if "rollback" not in path.name)


def apply_migration_file(database_url, outputs, vars_json, path):
    if path.name == "0031_thread_cleanup_drops.sql":
        psql(
            database_url,
            sql="""
DROP INDEX IF EXISTS public.idx_threads_tenant_status;
DROP INDEX IF EXISTS public.idx_threads_parent_id;
DROP TABLE IF EXISTS public.thread_comments CASCADE;
""",
        )
        return
    if path.name == "0070_compliance_aurora_roles.sql":
        ensure_compliance_roles(database_url, outputs, vars_json)
        return
    psql(database_url, file=path, variables={"stage": vars_json["stage"]})


def initialize_greenfield_database(database_url, outputs, vars_json):
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
    for path in migration_files():
        apply_migration_file(database_url, outputs, vars_json, path)


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def ensure_migration_ledger(database_url):
    psql(
        database_url,
        sql="""
CREATE TABLE IF NOT EXISTS public.platform_schema_migrations (
  name text PRIMARY KEY,
  source text NOT NULL DEFAULT 'runner',
  applied_at timestamptz NOT NULL DEFAULT now()
);
""",
    )


def recorded_platform_migrations(database_url):
    rows = psql_output(database_url, "SELECT name FROM public.platform_schema_migrations")
    return {line.strip() for line in rows.splitlines() if line.strip()}


def record_platform_migrations(database_url, names, source):
    names = list(names)
    if not names:
        return
    values = ", ".join(f"({sql_literal(name)}, {sql_literal(source)})" for name in names)
    psql(
        database_url,
        sql=(
            "INSERT INTO public.platform_schema_migrations (name, source) "
            f"VALUES {values} ON CONFLICT (name) DO NOTHING;"
        ),
    )


def declared_migration_objects(path):
    """Parse `-- creates*:` markers from a migration file's leading comment block."""
    objects = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if not stripped.startswith("--"):
            break
        for prefix, kind in MIGRATION_MARKER_KINDS:
            if stripped.startswith(prefix):
                name = stripped[len(prefix) :].strip()
                if name:
                    objects.append((kind, name))
                break
    return objects


def platform_migration_object_present(database_url, kind, name):
    """True/False when verifiable against the database; None when the marker
    names something we cannot check (the transition then assumes applied)."""
    parts = [part for part in name.split(".") if part]
    if kind == "column" and len(parts) == 3:
        schema, table, column = parts
        return bool(
            psql_output(
                database_url,
                "SELECT 1 FROM information_schema.columns WHERE "
                f"table_schema = {sql_literal(schema)} AND table_name = {sql_literal(table)} "
                f"AND column_name = {sql_literal(column)}",
            ).strip()
        )
    if kind == "constraint" and len(parts) == 3:
        schema, table, constraint = parts
        return bool(
            psql_output(
                database_url,
                "SELECT 1 FROM pg_constraint c "
                "JOIN pg_class r ON r.oid = c.conrelid "
                "JOIN pg_namespace n ON n.oid = r.relnamespace "
                f"WHERE n.nspname = {sql_literal(schema)} AND r.relname = {sql_literal(table)} "
                f"AND c.conname = {sql_literal(constraint)}",
            ).strip()
        )
    if kind == "object" and len(parts) == 2:
        schema, obj = parts
        return bool(
            psql_output(
                database_url,
                f"SELECT 1 WHERE to_regclass({sql_literal(name)}) IS NOT NULL "
                "UNION ALL SELECT 1 FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid = p.pronamespace "
                f"WHERE n.nspname = {sql_literal(schema)} AND p.proname = {sql_literal(obj)} "
                "LIMIT 1",
            ).strip()
        )
    if kind == "object" and len(parts) == 3:
        schema, table, child = parts
        return bool(
            psql_output(
                database_url,
                "SELECT 1 FROM information_schema.columns WHERE "
                f"table_schema = {sql_literal(schema)} AND table_name = {sql_literal(table)} "
                f"AND column_name = {sql_literal(child)} "
                "UNION ALL SELECT 1 FROM pg_constraint c "
                "JOIN pg_class r ON r.oid = c.conrelid "
                "JOIN pg_namespace n ON n.oid = r.relnamespace "
                f"WHERE n.nspname = {sql_literal(schema)} AND r.relname = {sql_literal(table)} "
                f"AND c.conname = {sql_literal(child)} "
                "UNION ALL SELECT 1 FROM pg_trigger t "
                "JOIN pg_class r ON r.oid = t.tgrelid "
                "JOIN pg_namespace n ON n.oid = r.relnamespace "
                f"WHERE n.nspname = {sql_literal(schema)} AND r.relname = {sql_literal(table)} "
                f"AND t.tgname = {sql_literal(child)} AND NOT t.tgisinternal "
                "LIMIT 1",
            ).strip()
        )
    return None


def backfill_platform_migration_ledger(database_url):
    """One-time ledger bootstrap for environments installed before the ledger
    existed. Every file shipping with this release is recorded as assumed
    applied — auto-re-running old files is unsafe (markers can name objects
    that later migrations intentionally dropped). Marker-verified drift is
    reported so an operator can true it up manually; releases after the
    transition apply through the exact pending path."""
    verified = []
    assumed = []
    for path in migration_files():
        verdicts = [
            platform_migration_object_present(database_url, kind, name)
            for kind, name in declared_migration_objects(path)
        ]
        if any(verdict is False for verdict in verdicts):
            print(
                f"[migrations] transition WARNING: {path.name} declares objects missing from "
                "this database; apply it manually if the feature it backs is expected here"
            )
            assumed.append(path.name)
        elif any(verdict is True for verdict in verdicts):
            verified.append(path.name)
        else:
            assumed.append(path.name)
    record_platform_migrations(database_url, verified, "transition-verified")
    record_platform_migrations(database_url, assumed, "transition-assumed")


def apply_pending_platform_migrations(database_url, outputs, vars_json):
    recorded = recorded_platform_migrations(database_url)
    for path in migration_files():
        if path.name in recorded:
            continue
        print(f"[migrations] applying {path.name}")
        apply_migration_file(database_url, outputs, vars_json, path)
        record_platform_migrations(database_url, [path.name], "runner")


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


def is_valid_tenant_slug(value):
    if not value or len(value) > 63:
        return False
    if value[0] == "-" or value[-1] == "-":
        return False
    return all(ch.isascii() and (ch.islower() or ch.isdigit() or ch == "-") for ch in value)


def is_plausible_email(value):
    if not value or any(ch.isspace() or ch in "'\"\\" for ch in value):
        return False
    local, sep, domain = value.partition("@")
    return bool(sep and local and "." in domain and domain[0] != "." and domain[-1] != ".")


def first_admin_email(vars_json):
    raw = vars_json.get("platform_operator_emails") or ""
    first = raw.split(",")[0].strip()
    return first if is_plausible_email(first) else ""


def first_admin_tenant_slug(payload, runner_secrets, vars_json):
    """Slug for the first-run tenant. MUST equal the customer-domain label when a
    customer domain is configured (KTD8: email-inbound resolves the tenant from
    the recipient subdomain), so the domain label outranks everything except an
    explicit override."""
    explicit = safe_get(
        runner_secrets,
        "tenantSlug",
        default=safe_get(payload, "tenantSlug", default=""),
    ).strip().lower()
    domain = (vars_json.get("customer_domain") or "").strip().lower()
    domain_label = domain.split(".")[0] if domain else ""
    candidate = explicit or domain_label or vars_json["stage"]
    if not is_valid_tenant_slug(candidate):
        raise RuntimeError(f"first-admin tenant slug {candidate!r} fails the slug pattern")
    if domain_label and candidate != domain_label:
        raise RuntimeError(
            f"first-admin tenant slug {candidate!r} must equal the customer domain "
            f"label {domain_label!r} (KTD8) — inbound email resolves tenants by subdomain"
        )
    return candidate


def cognito_idp(args, region, check=True):
    result = subprocess.run(
        ["aws", "cognito-idp", *args, "--region", region],
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"cognito-idp {args[0]} failed: {result.stderr.strip()}")
    return result


def ensure_first_admin_cognito_user(user_pool_id, email, region):
    """Idempotently ensure the first admin exists in the user pool. Returns
    (sub, created). New users get Cognito's invite email with a temporary
    password — sent by Cognito's default sender, so it works while the
    account's SES identity is still sandboxed."""
    probe = cognito_idp(
        ["admin-get-user", "--user-pool-id", user_pool_id, "--username", email],
        region,
        check=False,
    )
    created = False
    if probe.returncode != 0:
        if "UserNotFoundException" not in (probe.stderr or ""):
            raise RuntimeError(f"admin-get-user failed: {probe.stderr.strip()}")
        cognito_idp(
            [
                "admin-create-user",
                "--user-pool-id",
                user_pool_id,
                "--username",
                email,
                "--user-attributes",
                f"Name=email,Value={email}",
                "Name=email_verified,Value=true",
                "--desired-delivery-mediums",
                "EMAIL",
            ],
            region,
        )
        created = True
        probe = cognito_idp(
            ["admin-get-user", "--user-pool-id", user_pool_id, "--username", email],
            region,
        )
    attributes = json.loads(probe.stdout or "{}").get("UserAttributes", [])
    sub = next((a["Value"] for a in attributes if a.get("Name") == "sub"), "")
    if not sub:
        raise RuntimeError(f"could not resolve Cognito sub for {email}")
    return sub, created


FIRST_ADMIN_PROVISION_SQL = """
BEGIN;

-- Tenant: created only when the environment has no tenants at all. An
-- established environment is never given an extra tenant by this step.
INSERT INTO public.tenants (name, slug, plan, issue_prefix, issue_counter)
SELECT :'tenant_name', :'tenant_slug', 'free', 'TW', 0
WHERE NOT EXISTS (SELECT 1 FROM public.tenants);

INSERT INTO public.tenant_settings (tenant_id, default_model)
SELECT id, 'us.anthropic.claude-sonnet-4-6'
FROM public.tenants WHERE slug = :'tenant_slug'
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.users (tenant_id, email, name, workspace_folder_name, cognito_sub)
SELECT t.id, :'admin_email', :'admin_name', :'admin_folder', :'cognito_sub'
FROM public.tenants t
WHERE t.slug = :'tenant_slug'
  AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE lower(email) = lower(:'admin_email')
  );

-- Heal a stranded user row (signed in before provisioning existed).
UPDATE public.users u
SET tenant_id = t.id,
    cognito_sub = COALESCE(u.cognito_sub, :'cognito_sub'),
    updated_at = now()
FROM public.tenants t
WHERE t.slug = :'tenant_slug'
  AND lower(u.email) = lower(:'admin_email')
  AND u.tenant_id IS NULL;

INSERT INTO public.tenant_members (tenant_id, principal_type, principal_id, role, status)
SELECT u.tenant_id, 'user', u.id, 'owner', 'active'
FROM public.users u
JOIN public.tenants t ON t.id = u.tenant_id
WHERE t.slug = :'tenant_slug'
  AND lower(u.email) = lower(:'admin_email')
  AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
    WHERE m.tenant_id = u.tenant_id
      AND m.principal_type = 'user'
      AND m.principal_id = u.id
  );

UPDATE public.tenants t
SET pending_owner_email = NULL,
    first_admin_claim_required = false,
    first_admin_claimed_at = COALESCE(t.first_admin_claimed_at, now()),
    first_admin_claimed_user_id = COALESCE(t.first_admin_claimed_user_id, u.id),
    updated_at = now()
FROM public.users u
WHERE t.slug = :'tenant_slug'
  AND u.tenant_id = t.id
  AND lower(u.email) = lower(:'admin_email');

-- Default Space: created only when the tenant has no Spaces, so a fresh
-- environment's composer has a target without operator setup.
INSERT INTO public.spaces (
  tenant_id, slug, workspace_folder_name, name, description,
  status, kind, access_mode, template_key, config
)
SELECT t.id, 'general', 'general', 'General',
       'Default workspace created at install time.',
       'active', 'custom', 'public', 'general',
       '{"workflow":"custom","version":1,"source":"first_admin_bootstrap"}'::jsonb
FROM public.tenants t
WHERE t.slug = :'tenant_slug'
  AND NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.tenant_id = t.id);

INSERT INTO public.space_members (tenant_id, space_id, user_id, role, notification_preference)
SELECT s.tenant_id, s.id, u.id, 'owner', 'subscribed'
FROM public.spaces s
JOIN public.tenants t ON t.id = s.tenant_id
JOIN public.users u ON u.tenant_id = t.id AND lower(u.email) = lower(:'admin_email')
WHERE t.slug = :'tenant_slug'
  AND s.slug = 'general'
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members m WHERE m.space_id = s.id AND m.user_id = u.id
  );

COMMIT;
"""


def ensure_first_admin(outputs_path, vars_json, payload, runner_secrets):
    """First-run admin provisioning: when the deployment carries an adminEmail,
    make a fresh environment sign-in-ready — tenant (slug = customer-domain
    label, KTD8), Cognito admin user with an invite email, owner membership,
    custom:tenant_id, and a default Space. Idempotent; never mutates an
    environment that already has tenants beyond attaching the admin when the
    expected tenant slug exists. Non-fatal: failures are logged and echoed
    into deployment evidence (firstAdminBootstrap) instead of failing an
    otherwise healthy deploy."""
    global FIRST_ADMIN_EVIDENCE
    email = first_admin_email(vars_json)
    if not email:
        FIRST_ADMIN_EVIDENCE = {"status": "skipped", "reason": "no adminEmail configured"}
        return
    try:
        slug = first_admin_tenant_slug(payload, runner_secrets, vars_json)
        outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
        user_pool_id = (outputs.get("user_pool_id") or {}).get("value", "")
        if not user_pool_id:
            raise RuntimeError("terraform outputs are missing user_pool_id")
        database_url = database_url_from_outputs(outputs)

        tenant_count = int(psql_output(database_url, "SELECT count(*) FROM public.tenants") or 0)
        slug_present = bool(
            psql_output(
                database_url,
                f"SELECT 1 FROM public.tenants WHERE slug = {pg_literal(slug)}",
            ).strip()
        )
        if tenant_count and not slug_present:
            FIRST_ADMIN_EVIDENCE = {
                "status": "skipped",
                "reason": f"environment already has {tenant_count} tenant(s) and none is {slug!r}",
            }
            print(f"[runner] first-admin bootstrap skipped: {FIRST_ADMIN_EVIDENCE['reason']}")
            return

        region = vars_json.get("region") or os.environ.get("AWS_REGION") or "us-east-1"
        sub, created = ensure_first_admin_cognito_user(user_pool_id, email, region)
        local_part = email.split("@")[0]
        folder = "".join(
            ch if (ch.isascii() and (ch.islower() or ch.isdigit())) else "-"
            for ch in local_part.lower()
        ).strip("-") or "user"
        psql(
            database_url,
            sql=FIRST_ADMIN_PROVISION_SQL,
            variables={
                "tenant_name": slug.capitalize(),
                "tenant_slug": slug,
                "admin_email": email,
                "admin_name": local_part,
                "admin_folder": folder,
                "cognito_sub": sub,
            },
        )
        tenant_id = psql_output(
            database_url,
            f"SELECT id FROM public.tenants WHERE slug = {pg_literal(slug)}",
        ).strip()
        if tenant_id:
            cognito_idp(
                [
                    "admin-update-user-attributes",
                    "--user-pool-id",
                    user_pool_id,
                    "--username",
                    email,
                    "--user-attributes",
                    f"Name=custom:tenant_id,Value={tenant_id}",
                ],
                region,
            )
        # Re-run the platform seed so the just-created tenant gets the default
        # agent / settings / model approvals (the earlier seed saw no tenants).
        seed_platform_bootstrap_defaults(database_url)
        FIRST_ADMIN_EVIDENCE = {
            "status": "succeeded",
            "adminEmail": email,
            "tenantSlug": slug,
            "tenantId": tenant_id,
            "cognitoUserCreated": created,
            "inviteEmailSent": created,
        }
        print(
            f"[runner] first-admin bootstrap succeeded: tenant={slug} admin={email} "
            f"cognitoUserCreated={created}"
        )
    except Exception as exc:
        FIRST_ADMIN_EVIDENCE = {"status": "failed", "adminEmail": email, "error": str(exc)}
        print(f"[runner] first-admin bootstrap FAILED (non-fatal): {exc}")


def pg_literal(value):
    return "'" + value.replace("'", "''") + "'"


def push_database_schema(outputs_path, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    checkout_source(
        os.environ["THINKWORK_TERRAFORM_MODULE_SOURCE"],
        os.environ.get("THINKWORK_RELEASE_VERSION", "main"),
    )
    database_url = database_url_from_outputs(outputs)
    fresh = not psql_output(database_url, "SELECT to_regclass('public.tenants')").strip()
    ledger_present = bool(
        psql_output(
            database_url, "SELECT to_regclass('public.platform_schema_migrations')"
        ).strip()
    )
    if fresh:
        initialize_greenfield_database(database_url, outputs, vars_json)
    ensure_migration_ledger(database_url)
    if fresh:
        record_platform_migrations(
            database_url, [path.name for path in migration_files()], "greenfield"
        )
    elif not ledger_present:
        backfill_platform_migration_ledger(database_url)
    apply_pending_platform_migrations(database_url, outputs, vars_json)
    seed_platform_bootstrap_defaults(database_url)
    migrations = SOURCE / "packages/database-pg/drizzle"
    for name in POST_SEED_MIGRATIONS:
        path = migrations / name
        if not path.is_file():
            raise RuntimeError(f"Required platform migration is missing: {path}")
        apply_migration_file(database_url, outputs, vars_json, path)


def write_runner_files(payload, runner_secrets):
    preserved_config = payload.get("preservedConfig")
    if not isinstance(preserved_config, dict):
        preserved_config = {}
    reviewed_payload = dict(payload)
    reviewed_payload.update(preserved_config)
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
    current_state = current_terraform_state(stage)
    current_outputs = current_state.get("outputs")
    if not isinstance(current_outputs, dict):
        current_outputs = {}

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
    ensure_release_manifest_available(release_manifest_url, release_manifest_sha256)
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
        # Reuse the stage's existing service-auth secret (written to Secrets
        # Manager by terraform on the previous apply). Minting a fresh value
        # on every run rotated API_AUTH_SECRET per release, which silently
        # drifted the env copy away from the pinned Secrets Manager copy —
        # harmless while readers are env-first, fatal once env drops (R8).
        api_auth_secret = existing_stage_secret_string(stage, "api-auth")
    if not api_auth_secret:
        api_auth_secret = secrets.token_urlsafe(48)

    vars_json = {
        "stage": stage,
        "region": region,
        "account_id": account_id,
        "db_password": db_password,
        "api_auth_secret": api_auth_secret,
        "database_engine": safe_get(
            reviewed_payload,
            "databaseEngine",
            default="aurora-serverless",
        ),
        "enable_hindsight": safe_get_bool(
            {},
            reviewed_payload,
            "enableHindsight",
            default=False,
        ),
        "platform_operator_emails": safe_get(
            runner_secrets,
            "adminEmail",
            "platformOperatorEmails",
            default=safe_get(
                reviewed_payload,
                "adminEmail",
                "platformOperatorEmails",
                default="",
            ),
        ),
        "google_oauth_client_id": safe_get(
            runner_secrets,
            "googleOauthClientId",
            default=safe_get(
                reviewed_payload,
                "googleOauthClientId",
                default="",
            ),
        ),
        "google_oauth_client_secret": safe_get(
            runner_secrets,
            "googleOauthClientSecret",
            default=safe_get(
                reviewed_payload,
                "googleOauthClientSecret",
                default="",
            ),
        ),
        "microsoft_oauth_client_id": safe_get(
            runner_secrets,
            "microsoftOauthClientId",
            default=safe_get(
                reviewed_payload,
                "microsoftOauthClientId",
                default="",
            ),
        ),
        "microsoft_oauth_client_secret": safe_get(
            runner_secrets,
            "microsoftOauthClientSecret",
            default=safe_get(
                reviewed_payload,
                "microsoftOauthClientSecret",
                default="",
            ),
        ),
        "microsoft_oauth_tenant": safe_get(
            runner_secrets,
            "microsoftOauthTenant",
            default=safe_get(
                reviewed_payload,
                "microsoftOauthTenant",
                default="organizations",
            ),
        ),
        "cognito_email_source_arn": safe_get(
            runner_secrets,
            "cognitoEmailSourceArn",
            default=safe_get(
                reviewed_payload,
                "cognitoEmailSourceArn",
                default="",
            ),
        ),
        "cognito_from_email_address": safe_get(
            runner_secrets,
            "cognitoFromEmailAddress",
            default=safe_get(
                reviewed_payload,
                "cognitoFromEmailAddress",
                default="",
            ),
        ),
        "cognito_reply_to_email_address": safe_get(
            runner_secrets,
            "cognitoReplyToEmailAddress",
            default=safe_get(
                reviewed_payload,
                "cognitoReplyToEmailAddress",
                default="",
            ),
        ),
        "app_domain": safe_get(
            runner_secrets,
            "appDomain",
            default=safe_get(reviewed_payload, "appDomain", default=""),
        ),
        "app_certificate_arn": safe_get(
            runner_secrets,
            "appCertificateArn",
            default=safe_get(reviewed_payload, "appCertificateArn", default=""),
        ),
        "customer_domain": safe_get(
            runner_secrets,
            "customerDomain",
            default=safe_get(reviewed_payload, "customerDomain", default=""),
        ),
        "customer_domain_delegated": safe_get_bool(
            runner_secrets,
            reviewed_payload,
            "customerDomainDelegated",
            default=False,
        ),
        "customer_domain_legacy_retired": safe_get_bool(
            runner_secrets,
            reviewed_payload,
            "customerDomainLegacyRetired",
            default=False,
        ),
        "lambda_artifact_bucket": os.environ["THINKWORK_RELEASE_ARTIFACT_BUCKET"],
        "lambda_artifact_prefix": f"releases/{release_version}/lambdas",
        "deployment_release_version": release_version,
        "deployment_release_manifest_url": release_manifest_url,
        "deployment_release_manifest_sha256": release_manifest_sha256,
        "deployment_release_manifest_signature_url": release_manifest_signature_url,
        "deployment_release_manifest_trust_policy": release_manifest_trust_policy_value,
        "deployment_release_manifest_trusted_keys_json": release_manifest_trusted_keys_json,
        "deployment_state_machine_arn": os.environ.get(
            "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
            "",
        ),
        "deployment_evidence_bucket": os.environ.get("THINKWORK_EVIDENCE_BUCKET", ""),
        "deployment_terraform_module_source": module_source,
        "deployment_terraform_module_version": terraform_module_version,
        "agentcore_pi_source_image_uri": safe_get(
            payload,
            "agentcorePiSourceImageUri",
            default=release_runtime_image("agentcore-pi-amd64"),
        ),
    }
    enforce_customer_domain_preservation(
        current_outputs,
        vars_json,
        payload,
        runner_secrets,
    )
    vars_json.update(
        managed_app_terraform_overrides(payload, stage, account_id, current_outputs, current_state)
    )

    TF.mkdir(parents=True, exist_ok=True)
    (TF / "backend.hcl").write_text(
        "\n".join(
            [
                f"bucket = {hcl_string(os.environ['THINKWORK_TERRAFORM_STATE_BUCKET'])}",
                f"key = {hcl_string(terraform_backend_key(stage, payload))}",
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

# The thinkwork module declares configuration_aliases = [aws.us_east_1]
# (customer-domain ACM certificates must live in us-east-1 for CloudFront),
# so every generated root must define the alias and pass it through the
# module's providers mapping — even when no customer domain is configured.
provider "aws" {{
  alias  = "us_east_1"
  region = "us-east-1"
}}

# Existing greenfield stacks keep Cloudflare DNS resources in the same state
# file. Managed-app targeted plans still need the provider schema available
# even though they do not change those records.
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

variable "cognito_email_source_arn" {{
  type = string
}}

variable "cognito_from_email_address" {{
  type = string
}}

variable "cognito_reply_to_email_address" {{
  type = string
}}

variable "app_domain" {{
  type = string
}}

variable "app_certificate_arn" {{
  type = string
}}

variable "customer_domain" {{
  type = string
}}

variable "customer_domain_delegated" {{
  type = bool
}}

variable "customer_domain_legacy_retired" {{
  type = bool
}}

variable "google_oauth_client_id" {{
  type = string
}}

variable "google_oauth_client_secret" {{
  type      = string
  sensitive = true
}}

variable "microsoft_oauth_client_id" {{
  type = string
}}

variable "microsoft_oauth_client_secret" {{
  type      = string
  sensitive = true
}}

variable "microsoft_oauth_tenant" {{
  type = string
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

variable "deployment_state_machine_arn" {{
  type = string
}}

variable "deployment_evidence_bucket" {{
  type = string
}}

variable "deployment_terraform_module_source" {{
  type = string
}}

variable "deployment_terraform_module_version" {{
  type = string
}}

variable "deployment_control_plane_create_secret_placeholders" {{
  type = bool
}}

variable "enable_cognee" {{
  type = bool
}}

variable "cognee_image_uri" {{
  type = string
}}

variable "cognee_db_username" {{
  type = string
}}

variable "cognee_db_name" {{
  type = string
}}

variable "cognee_db_password_secret_arn" {{
  type = string
}}

variable "cognee_backend_mode" {{
  type = string
}}

variable "cognee_desired_count" {{
  type = number
}}

variable "cognee_brain_tenant_id" {{
  type = string
}}

variable "cognee_brain_instance_key" {{
  type = string
}}

variable "cognee_brain_storage_tier" {{
  type = string
}}

variable "cognee_brain_s3_artifact_root" {{
  type = string
}}

variable "cognee_brain_s3_manifest_root" {{
  type = string
}}

variable "cognee_brain_s3_vault_projection_root" {{
  type = string
}}

variable "cognee_private_substrate_mode" {{
  type = bool
}}

variable "cognee_llm_provider" {{
  type = string
}}

variable "cognee_llm_model" {{
  type = string
}}

variable "cognee_embedding_provider" {{
  type = string
}}

variable "cognee_embedding_model" {{
  type = string
}}

variable "cognee_embedding_dimensions" {{
  type = number
}}

variable "cognee_vector_db_provider" {{
  type = string
}}

variable "cognee_graph_database_provider" {{
  type = string
}}

variable "cognee_neptune_graph_id" {{
  type = string
}}

variable "cognee_neptune_endpoint" {{
  type = string
}}

variable "cognee_production_posture" {{
  type = string
}}

variable "cognee_bedrock_model_resource_arns" {{
  type = list(string)
}}

variable "enable_deployment_control_plane" {{
  type = bool
}}

variable "twenty_provisioned" {{
  type = bool
}}

variable "twenty_runtime_enabled" {{
  type = bool
}}

variable "twenty_image_uri" {{
  type = string
}}

variable "twenty_db_username" {{
  type = string
}}

variable "twenty_db_name" {{
  type = string
}}

variable "twenty_db_url_secret_arn" {{
  type = string
}}

variable "twenty_encryption_key_secret_arn" {{
  type = string
}}

variable "twenty_email_from_address" {{
  type = string
}}

variable "twenty_email_from_name" {{
  type = string
}}

variable "twenty_public_url" {{
  type = string
}}

variable "twenty_certificate_arn" {{
  type = string
}}

variable "plane_provisioned" {{
  type = bool
}}

variable "plane_runtime_enabled" {{
  type = bool
}}

variable "plane_image_uri" {{
  type = string
}}

variable "plane_frontend_image_uri" {{
  type = string
}}

variable "plane_backend_image_uri" {{
  type = string
}}

variable "plane_space_image_uri" {{
  type = string
}}

variable "plane_admin_image_uri" {{
  type = string
}}

variable "plane_live_image_uri" {{
  type = string
}}

variable "plane_mcp_image_uri" {{
  type = string
}}

variable "plane_db_url_secret_arn" {{
  type = string
}}

variable "plane_secret_key_secret_arn" {{
  type = string
}}

variable "plane_live_server_secret_key_secret_arn" {{
  type = string
}}

variable "plane_aes_secret_key_secret_arn" {{
  type = string
}}

variable "plane_s3_access_key_id_secret_arn" {{
  type = string
}}

variable "plane_s3_secret_access_key_secret_arn" {{
  type = string
}}

variable "plane_s3_bucket_name" {{
  type = string
}}

variable "plane_domain" {{
  type = string
}}

variable "plane_public_url" {{
  type = string
}}

variable "plane_certificate_arn" {{
  type = string
}}

variable "plane_web_container_port" {{
  type = number
}}

variable "cloudflare_zone_id" {{
  type = string
}}

variable "plane_dns_enabled" {{
  type = bool
}}

variable "plane_dns_name" {{
  type = string
}}

module "thinkwork" {{
  source  = {hcl_string(terraform_module_source)}
{module_version_line}
  providers = {{
    aws.us_east_1 = aws.us_east_1
  }}

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  db_password     = var.db_password
  api_auth_secret = var.api_auth_secret
  database_engine = var.database_engine

  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  microsoft_oauth_client_id     = var.microsoft_oauth_client_id
  microsoft_oauth_client_secret = var.microsoft_oauth_client_secret
  microsoft_oauth_tenant        = var.microsoft_oauth_tenant
  platform_operator_emails   = var.platform_operator_emails

  cognito_email_source_arn       = var.cognito_email_source_arn
  cognito_from_email_address     = var.cognito_from_email_address
  cognito_reply_to_email_address = var.cognito_reply_to_email_address

  app_domain          = var.app_domain
  app_certificate_arn = var.app_certificate_arn

  customer_domain                = var.customer_domain
  customer_domain_delegated      = var.customer_domain_delegated
  customer_domain_legacy_retired = var.customer_domain_legacy_retired

  lambda_artifact_bucket   = var.lambda_artifact_bucket
  lambda_artifact_prefix   = var.lambda_artifact_prefix
  require_lambda_artifacts = true
  agentcore_pi_source_image_uri = var.agentcore_pi_source_image_uri

  enable_hindsight               = var.enable_hindsight
  enable_workspace_orchestration = true

  enable_cognee          = var.enable_cognee
  cognee_image_uri       = var.cognee_image_uri
  cognee_db_username     = var.cognee_db_username
  cognee_db_name         = var.cognee_db_name
  cognee_db_password_secret_arn = var.cognee_db_password_secret_arn
  cognee_backend_mode    = var.cognee_backend_mode
  cognee_desired_count   = var.cognee_desired_count
  cognee_brain_tenant_id                = var.cognee_brain_tenant_id
  cognee_brain_instance_key             = var.cognee_brain_instance_key
  cognee_brain_storage_tier             = var.cognee_brain_storage_tier
  cognee_brain_s3_artifact_root         = var.cognee_brain_s3_artifact_root
  cognee_brain_s3_manifest_root         = var.cognee_brain_s3_manifest_root
  cognee_brain_s3_vault_projection_root = var.cognee_brain_s3_vault_projection_root
  cognee_private_substrate_mode         = var.cognee_private_substrate_mode
  cognee_llm_provider                   = var.cognee_llm_provider
  cognee_llm_model                      = var.cognee_llm_model
  cognee_embedding_provider             = var.cognee_embedding_provider
  cognee_embedding_model                = var.cognee_embedding_model
  cognee_embedding_dimensions           = var.cognee_embedding_dimensions
  cognee_vector_db_provider             = var.cognee_vector_db_provider
  cognee_graph_database_provider        = var.cognee_graph_database_provider
  cognee_neptune_graph_id               = var.cognee_neptune_graph_id
  cognee_neptune_endpoint               = var.cognee_neptune_endpoint
  cognee_production_posture             = var.cognee_production_posture
  cognee_bedrock_model_resource_arns    = var.cognee_bedrock_model_resource_arns
  twenty_provisioned     = var.twenty_provisioned
  twenty_runtime_enabled = var.twenty_runtime_enabled
  twenty_image_uri       = var.twenty_image_uri
  twenty_db_username     = var.twenty_db_username
  twenty_db_name         = var.twenty_db_name
  twenty_db_url_secret_arn         = var.twenty_db_url_secret_arn
  twenty_encryption_key_secret_arn = var.twenty_encryption_key_secret_arn
  twenty_email_from_address        = var.twenty_email_from_address
  twenty_email_from_name           = var.twenty_email_from_name
  twenty_public_url                = var.twenty_public_url
  twenty_certificate_arn           = var.twenty_certificate_arn
  plane_provisioned      = var.plane_provisioned
  plane_runtime_enabled  = var.plane_runtime_enabled
  plane_image_uri        = var.plane_image_uri

  plane_frontend_image_uri = var.plane_frontend_image_uri
  plane_backend_image_uri  = var.plane_backend_image_uri
  plane_space_image_uri    = var.plane_space_image_uri
  plane_admin_image_uri    = var.plane_admin_image_uri
  plane_live_image_uri     = var.plane_live_image_uri
  plane_mcp_image_uri      = var.plane_mcp_image_uri

  plane_db_url_secret_arn                 = var.plane_db_url_secret_arn
  plane_secret_key_secret_arn             = var.plane_secret_key_secret_arn
  plane_live_server_secret_key_secret_arn = var.plane_live_server_secret_key_secret_arn
  plane_aes_secret_key_secret_arn         = var.plane_aes_secret_key_secret_arn
  plane_s3_access_key_id_secret_arn       = var.plane_s3_access_key_id_secret_arn
  plane_s3_secret_access_key_secret_arn   = var.plane_s3_secret_access_key_secret_arn
  plane_s3_bucket_name                    = var.plane_s3_bucket_name
  plane_domain                            = var.plane_domain
  plane_public_url                        = var.plane_public_url
  plane_certificate_arn                   = var.plane_certificate_arn
  plane_web_container_port                = var.plane_web_container_port

  enable_stripe_billing      = false
  enable_slack_workspace_app = false

  enable_deployment_control_plane    = var.enable_deployment_control_plane
  deployment_control_plane_create_secret_placeholders = var.deployment_control_plane_create_secret_placeholders
  deployment_state_machine_arn        = var.deployment_state_machine_arn
  deployment_evidence_bucket          = var.deployment_evidence_bucket
  deployment_release_version         = var.deployment_release_version
  deployment_release_manifest_url    = var.deployment_release_manifest_url
  deployment_release_manifest_sha256 = var.deployment_release_manifest_sha256
  deployment_release_manifest_signature_url     = var.deployment_release_manifest_signature_url
  deployment_release_manifest_trust_policy      = var.deployment_release_manifest_trust_policy
  deployment_release_manifest_trusted_keys_json = var.deployment_release_manifest_trusted_keys_json
  deployment_terraform_module_source            = var.deployment_terraform_module_source
  deployment_terraform_module_version           = var.deployment_terraform_module_version
}}

resource "cloudflare_record" "plane" {{
  count = var.plane_dns_enabled ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.plane_dns_name
  content = module.thinkwork.plane_alb_dns_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${{var.stage}} plane → Plane public ALB"
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
output "customer_domain" {{ value = module.thinkwork.customer_domain }}
output "customer_domain_name_servers" {{ value = module.thinkwork.customer_domain_name_servers }}
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
output "deployment_control_plane_enabled" {{ value = module.thinkwork.deployment_control_plane_enabled }}
output "deployment_state_machine_arn" {{ value = module.thinkwork.deployment_state_machine_arn }}
output "deployment_state_machine_name" {{ value = module.thinkwork.deployment_state_machine_name }}
output "deployment_runner_project_name" {{ value = module.thinkwork.deployment_runner_project_name }}
output "deployment_runner_project_arn" {{ value = module.thinkwork.deployment_runner_project_arn }}
output "deployment_evidence_bucket_name" {{ value = module.thinkwork.deployment_evidence_bucket_name }}
output "deployment_ssm_prefix" {{ value = module.thinkwork.deployment_ssm_prefix }}
output "deployment_appconfig_application_id" {{ value = module.thinkwork.deployment_appconfig_application_id }}
output "deployment_appconfig_environment_id" {{ value = module.thinkwork.deployment_appconfig_environment_id }}
output "deployment_appconfig_configuration_profile_id" {{ value = module.thinkwork.deployment_appconfig_configuration_profile_id }}
output "plane_provisioned" {{ value = module.thinkwork.plane_provisioned }}
output "plane_runtime_enabled" {{ value = module.thinkwork.plane_runtime_enabled }}
output "plane_url" {{ value = module.thinkwork.plane_url }}
output "plane_alb_arn" {{ value = module.thinkwork.plane_alb_arn }}
output "plane_target_group_arn" {{ value = module.thinkwork.plane_target_group_arn }}
output "plane_cluster_arn" {{ value = module.thinkwork.plane_cluster_arn }}
output "plane_web_service_name" {{ value = module.thinkwork.plane_web_service_name }}
output "plane_api_service_name" {{ value = module.thinkwork.plane_api_service_name }}
output "plane_worker_service_name" {{ value = module.thinkwork.plane_worker_service_name }}
output "plane_beat_worker_service_name" {{ value = module.thinkwork.plane_beat_worker_service_name }}
output "plane_live_service_name" {{ value = module.thinkwork.plane_live_service_name }}
output "plane_mcp_service_name" {{ value = module.thinkwork.plane_mcp_service_name }}
output "plane_web_log_group_name" {{ value = module.thinkwork.plane_web_log_group_name }}
output "plane_api_log_group_name" {{ value = module.thinkwork.plane_api_log_group_name }}
output "plane_worker_log_group_name" {{ value = module.thinkwork.plane_worker_log_group_name }}
output "plane_beat_worker_log_group_name" {{ value = module.thinkwork.plane_beat_worker_log_group_name }}
output "plane_live_log_group_name" {{ value = module.thinkwork.plane_live_log_group_name }}
output "plane_mcp_log_group_name" {{ value = module.thinkwork.plane_mcp_log_group_name }}
output "plane_cache_endpoint" {{ value = module.thinkwork.plane_cache_endpoint }}
output "plane_rabbitmq_broker_arn" {{ value = module.thinkwork.plane_rabbitmq_broker_arn }}
output "plane_storage_bucket_name" {{ value = module.thinkwork.plane_storage_bucket_name }}
""",
        encoding="utf-8",
    )
    return vars_json


def sync_release_artifacts(artifact_types=None, artifact_names=None):
    global RELEASE_EVIDENCE
    artifact_types = set(artifact_types or {"lambda", "static-site"})
    artifact_names = set(artifact_names or [])
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
        if artifact.get("type") not in artifact_types:
            continue
        if artifact_names and artifact.get("name") not in artifact_names:
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


def write_current_outputs_from_state(stage, outputs_path):
    outputs = current_terraform_outputs(stage)
    required = ["app_bucket_name", "app_distribution_id", "app_url"]
    missing = [name for name in required if name not in outputs]
    if missing:
        raise RuntimeError(
            "Web-only update requires existing Terraform outputs in state; missing "
            + ", ".join(missing)
        )
    outputs_path.parent.mkdir(parents=True, exist_ok=True)
    outputs_path.write_text(json.dumps(outputs, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return outputs


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

    def external_identity_providers():
        raw = output_value("identity_provider_names") or []
        if not isinstance(raw, list):
            return ["Google"]
        providers = [
            provider
            for provider in raw
            if isinstance(provider, str) and provider != "COGNITO"
        ]
        return providers or ["COGNITO"]

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
        "identityProviders": external_identity_providers(),
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
        "VITE_AUTH_IDENTITY_PROVIDERS": ",".join(profile["identityProviders"]),
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


def sync_static(outputs_path, static_files, vars_json, artifact_names=None):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    artifact_names = set(artifact_names or [])
    syncs = [
        ("web", "app_bucket_name", "app_distribution_id"),
        ("docs", "docs_bucket_name", "docs_distribution_id"),
    ]
    for artifact_name, bucket_output, distribution_output in syncs:
        if artifact_names and artifact_name not in artifact_names:
            continue
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


def read_current_status_pointer(bucket):
    try:
        return json.loads(
            output(["aws", "s3", "cp", f"s3://{bucket}/deployment/status/current.json", "-"])
        )
    except Exception:
        return {}


def build_deployment_status_pointer(
    status,
    *,
    action,
    release,
    previous,
    controller,
    environment_url,
    stage,
    region,
    account_id,
    started_at,
    recorded_at,
    terraform_exit_code=None,
    error=None,
    evidence_bucket=None,
    evidence_key=None,
):
    pointer = {
        "schemaVersion": 1,
        "contract": "thinkwork.deployment.status.v1",
        "stage": stage,
        "region": region,
        "accountId": account_id,
        "environmentUrl": environment_url or previous.get("environmentUrl"),
        "status": status,
        "action": action,
        "source": "deployment-controller",
        "recordedAt": recorded_at,
        "controller": {key: value for key, value in controller.items() if value},
    }
    if status == "succeeded":
        pointer["activeRelease"] = release
        pointer["lastSuccessfulDeployment"] = {
            "sessionId": controller.get("sessionId"),
            "startedAt": started_at,
            "finishedAt": recorded_at,
            "terraformExitCode": terraform_exit_code,
            "evidenceBucket": evidence_bucket,
            "evidenceKey": evidence_key,
        }
    else:
        pointer["targetRelease"] = release
        for carried in ("activeRelease", "lastSuccessfulDeployment", "historyKey"):
            if previous.get(carried):
                pointer[carried] = previous[carried]
        if error:
            pointer["error"] = str(error)
    return pointer


def write_deployment_status_pointer(status, vars_json=None, terraform_exit_code=None, error=None):
    """Publish environment-owned deployed-release state. Best-effort: a status
    write must never change the deploy result."""
    bucket = os.environ.get("THINKWORK_EVIDENCE_BUCKET")
    action = os.environ.get("THINKWORK_DEPLOYMENT_ACTION")
    if os.environ.get("THINKWORK_MANAGED_APP_OPERATION") == "true":
        return
    if not bucket or action not in {"deploy", "update", "web"}:
        return
    vars_json = vars_json or {}
    previous = read_current_status_pointer(bucket)
    environment_url = None
    outputs_path = TF / "outputs.json"
    if outputs_path.is_file():
        try:
            outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
            environment_url = outputs.get("app_url", {}).get("value")
        except Exception:
            environment_url = None
    recorded_at = datetime.now(UTC).isoformat()
    prefix = os.environ.get("THINKWORK_EVIDENCE_PREFIX")
    pointer = build_deployment_status_pointer(
        status,
        action=action,
        release={
            "version": os.environ.get("THINKWORK_RELEASE_VERSION"),
            "manifestUrl": os.environ.get("THINKWORK_RELEASE_MANIFEST_URL"),
            "manifestSha256": os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256"),
        },
        previous=previous,
        controller={
            "stateMachineArn": os.environ.get("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN"),
            "codebuildProjectName": os.environ.get("THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME"),
            "codebuildBuildId": os.environ.get("CODEBUILD_BUILD_ID"),
            "sessionId": os.environ.get("THINKWORK_DEPLOYMENT_SESSION_ID"),
        },
        environment_url=environment_url,
        stage=os.environ.get("THINKWORK_STAGE"),
        region=vars_json.get("region") or os.environ.get("AWS_REGION"),
        account_id=vars_json.get("account_id") or previous.get("accountId"),
        started_at=STARTED_AT,
        recorded_at=recorded_at,
        terraform_exit_code=terraform_exit_code,
        error=error,
        evidence_bucket=bucket,
        evidence_key=f"{prefix}/deployment-evidence.json" if prefix else None,
    )
    if status in {"succeeded", "failed"}:
        timestamp = recorded_at.replace("-", "").replace(":", "").split(".")[0] + "Z"
        version = (
            pointer.get("activeRelease") or pointer.get("targetRelease") or {}
        ).get("version") or "unknown"
        pointer["historyKey"] = f"deployment/status/history/{timestamp}-{version}.json"
    body = Path("deployment-status-pointer.json")
    body.write_text(json.dumps(pointer, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if status in {"succeeded", "failed"}:
        run(["aws", "s3", "cp", str(body), f"s3://{bucket}/{pointer['historyKey']}"])
    run(["aws", "s3", "cp", str(body), f"s3://{bucket}/deployment/status/current.json"])


def self_update_runner_script():
    """Refresh the controller's runner script from the release source just
    deployed. The customer-update terraform root provisions with
    enable_deployment_control_plane = false (the controller cannot manage
    itself mid-run), so nothing else ever updates the script the next build
    downloads — without this step it stays frozen at provision time."""
    script_uri = os.environ.get("THINKWORK_RUNNER_SCRIPT_S3_URI")
    if not script_uri:
        return
    source_script = SOURCE / "terraform/modules/app/deployment-control-plane/runner.py"
    if not source_script.is_file():
        print("[runner] release source has no runner.py; skipping self-update")
        return
    run(["aws", "s3", "cp", str(source_script), script_uri])
    print(f"[runner] self-updated runner script at {script_uri}")


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
    if "customer_domain" in vars_json:
        # Echoed-fields guard (KTD5): record the domain fields this runner
        # version actually consumed so the controller can detect an outdated
        # runner that silently dropped them. Booleans must stay booleans.
        evidence["consumedDomainFields"] = {
            "customerDomain": vars_json.get("customer_domain", ""),
            "customerDomainDelegated": bool(vars_json.get("customer_domain_delegated", False)),
            "customerDomainLegacyRetired": bool(
                vars_json.get("customer_domain_legacy_retired", False)
            ),
        }
    if error:
        evidence["error"] = str(error)
    if FIRST_ADMIN_EVIDENCE:
        evidence["firstAdminBootstrap"] = FIRST_ADMIN_EVIDENCE
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
    try:
        write_deployment_status_pointer(status, vars_json, terraform_exit_code, error)
    except Exception as status_error:
        print(f"[status] failed to write deployment status pointer: {status_error}")


def main():
    global CONTROLLER_EVIDENCE, TERRAFORM_EVIDENCE
    WORK.mkdir(parents=True, exist_ok=True)
    payload = read_json_env("THINKWORK_DEPLOYMENT_INPUT", {})
    apply_release_selection(payload)
    action = os.environ.get("THINKWORK_DEPLOYMENT_ACTION") or payload.get("action") or "deploy"
    if action == "teardown":
        action = "destroy"
    if action not in {"deploy", "update", "destroy", "plan", "status", "web"}:
        raise RuntimeError(f"Unsupported deployment action: {action}")
    os.environ["THINKWORK_DEPLOYMENT_ACTION"] = action
    configure_managed_app_evidence_prefix(payload)

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
    web_only = is_web_only_operation(payload, action)
    static_files = {}
    if action in {"deploy", "update", "web"} and not is_managed_app_operation(payload):
        static_files = sync_release_artifacts(
            artifact_types={"static-site"} if web_only else None,
            artifact_names={"web"} if web_only else None,
        )
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

    if web_only:
        outputs_path = TF / "outputs.json"
        write_current_outputs_from_state(vars_json["stage"], outputs_path)
        TERRAFORM_EVIDENCE["outputs"] = {
            "fileName": "terraform-outputs.json",
            "sha256": sha256_file(outputs_path),
            "s3Uri": upload_evidence_artifact(outputs_path, "terraform-outputs.json"),
            "source": "state",
        }
        sync_static(outputs_path, static_files, vars_json, artifact_names={"web"})
        selected_controller_release = write_controller_release_selection_to_ssm(vars_json)
        if selected_controller_release:
            CONTROLLER_EVIDENCE["releaseSelection"] = write_json_evidence_artifact(
                "controller-release-selection.json",
                selected_controller_release,
            )
        write_evidence("succeeded", vars_json, 0)
        return 0

    configure_cloudflare_provider_auth(vars_json["stage"])
    configure_terraform_provider_mirror()
    run(["terraform", "init", "-backend-config=backend.hcl", "-no-color"], cwd=TF)
    workspace = terraform_workspace_name(vars_json["stage"], payload)
    if workspace != "default":
        selected = subprocess.run(
            ["terraform", "workspace", "select", workspace, "-no-color"],
            cwd=TF,
            text=True,
        )
        if selected.returncode != 0:
            run(["terraform", "workspace", "new", workspace, "-no-color"], cwd=TF)
    target_args = managed_app_terraform_target_args(payload)
    if action == "destroy":
        plan = subprocess.run(
            ["terraform", "plan", "-destroy", *target_args, "-out=tfplan", "-no-color"],
            cwd=TF,
            text=True,
        )
        if plan.returncode == 0:
            TERRAFORM_EVIDENCE["plan"] = write_terraform_plan_evidence(payload)
            result = subprocess.run(
                ["terraform", "apply", "-auto-approve", "-no-color", "tfplan"],
                cwd=TF,
                text=True,
            )
        else:
            result = plan
    else:
        plan = subprocess.run(
            ["terraform", "plan", *target_args, "-out=tfplan", "-no-color"],
            cwd=TF,
            text=True,
        )
        if plan.returncode == 0:
            TERRAFORM_EVIDENCE["plan"] = write_terraform_plan_evidence(payload)
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
        refresh_outputs_after_targeted_apply(payload)
        outputs_path.write_text(output(["terraform", "output", "-json"], cwd=TF), encoding="utf-8")
        TERRAFORM_EVIDENCE["outputs"] = {
            "fileName": "terraform-outputs.json",
            "sha256": sha256_file(outputs_path),
            "s3Uri": upload_evidence_artifact(outputs_path, "terraform-outputs.json"),
        }
        if not is_managed_app_operation(payload):
            push_database_schema(outputs_path, vars_json)
            ensure_first_admin(outputs_path, vars_json, payload, runner_secrets)
            write_outputs_to_ssm(outputs_path, vars_json)
            selected_controller_release = write_controller_release_selection_to_ssm(vars_json)
            if selected_controller_release:
                CONTROLLER_EVIDENCE["releaseSelection"] = write_json_evidence_artifact(
                    "controller-release-selection.json",
                    selected_controller_release,
                )
            sync_static(outputs_path, static_files, vars_json)
            try:
                self_update_runner_script()
            except Exception as self_update_error:
                print(f"[runner] self-update failed (non-fatal): {self_update_error}")
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
