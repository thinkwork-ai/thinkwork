import base64
import hashlib
import json
import os
import platform
import re
import secrets
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

WORK = Path("/tmp/thinkwork-platform-deploy")
RELEASE = WORK / "release"
SOURCE = WORK / "source"
TF = WORK / "terraform"
MANIFEST = RELEASE / "thinkwork-release.json"
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
MANAGED_APP_EVIDENCE = {}
RELEASE_MANIFEST_TRUST_POLICIES = {
    "allow_unsigned_canary",
    "require_signature",
}
# Migrations that intentionally re-run after seed data lands (idempotent;
# they backfill from seeded rows). Everything else is ledger-driven.
POST_SEED_MIGRATIONS = [
    "0155_tenant_model_catalog.sql",
]
AUTH_RETIREMENT_MIGRATION_MARKER = "-- deployment-phase: auth-retired"
PLATFORM_MIGRATION_LEDGER_CUTOFF = 260
MIGRATION_MARKER_KINDS = [
    ("-- creates-column:", "column"),
    ("-- creates-constraint:", "constraint"),
    ("-- creates:", "object"),
]
NATIVE_AUTH_CUSTOM_ATTRIBUTES = [
    {
        "AttributeDataType": "String",
        "DeveloperOnlyAttribute": False,
        "Mutable": True,
        "Name": "entra_tenant_id",
        "Required": False,
        "StringAttributeConstraints": {"MinLength": "0", "MaxLength": "36"},
    },
    {
        "AttributeDataType": "String",
        "DeveloperOnlyAttribute": False,
        "Mutable": True,
        "Name": "entra_object_id",
        "Required": False,
        "StringAttributeConstraints": {"MinLength": "0", "MaxLength": "36"},
    },
]
AGENTCORE_CONTROL_SDK_VERSION = "3.1089.0"
TERRAFORM_PLAN_APPROVAL_CONTRACT = "thinkwork.terraform.saved-plan-approval.v1"
TERRAFORM_PLAN_DESCRIPTOR_NAME = "terraform-plan-approval.json"
TERRAFORM_SAVED_PLAN_NAME = "terraform-plan.bin"
TEI_V380_RECOVERY_CONTRACT = "thinkwork.incident.tei-v380-proof-plane-recovery.v1"
TEI_V380_RECOVERY_INCIDENT_ID = "tei-v380-proof-plane-partial-apply"
TEI_V380_REJECTED_PLAN_SHA256 = "ba7b0ffa099f725b4f32e394446ee43693fe3dd4b7a9eb639d47eb833d40db84"
TEI_V380_STATE_LINEAGE = "61f4093e-41da-ac29-852a-267bc853e24f"
TEI_V380_STATE_SERIAL = 819
TEI_V380_STATE_SHA256 = "cc99973e7b80e1a0c6e1097d889e006e5e2610e236ed730a02ca5f3457b99d7f"
TEI_V380_STATE_BUCKET = "tei-thinkwork-terraform-state"
TEI_V380_STATE_KEY = "env:/tei-e2e/thinkwork/tei-e2e/terraform.tfstate"
TEI_V380_LOCK_TABLE = "tei-thinkwork-terraform-locks"
TEI_V380_LOCK_KEY = f"{TEI_V380_STATE_BUCKET}/{TEI_V380_STATE_KEY}"
TEI_V380_LOCK_ID = "04b3e9a1-3de6-c668-87e7-43d94280605e"
TEI_V380_STATE_DIGEST = "7fe214eeaae491f5c1d8d792bddbbb19"
TEI_V380_SECRET_ARN = (
    "arn:aws:secretsmanager:us-east-1:637423202447:secret:"
    "thinkwork/tei-e2e/agentcore-identity/twenty-crm-oauth-client-7OeAlG"
)
TEI_V380_SECRET_NAME = "thinkwork/tei-e2e/agentcore-identity/twenty-crm-oauth-client"
TEI_V380_SECRET_ADDRESS = (
    "module.thinkwork.module.agentcore_proof_identity."
    "aws_secretsmanager_secret.twenty_oauth_client[0]"
)
TEI_V380_KMS_KEY_ID = "8798ab48-cd60-477d-a96e-c2d56bae7b40"
TEI_V380_KMS_KEY_ARN = "arn:aws:kms:us-east-1:637423202447:key/8798ab48-cd60-477d-a96e-c2d56bae7b40"
TEI_V380_KMS_KEY_ADDRESS = 'module.thinkwork.module.api.aws_kms_key.agentcore_turn_assertion["v1"]'
TEI_V380_KMS_ALIAS = "alias/thinkwork-tei-e2e-agentcore-turn-assertion-v1"
TEI_V380_KMS_ALIAS_ADDRESS = (
    'module.thinkwork.module.api.aws_kms_alias.agentcore_turn_assertion["v1"]'
)
TEI_V380_OWNER_ALLOWLIST = (
    "0ea2f626-8b40-43ca-b7f1-3601b2a6bef8,f498f488-70a1-709b-24d7-f895f2164301"
)


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


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


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


def patch_downloaded_customer_domain_module():
    module_path = (
        TF
        / ".terraform"
        / "modules"
        / "thinkwork"
        / "terraform"
        / "modules"
        / "app"
        / "customer-domain"
        / "main.tf"
    )
    if not module_path.exists():
        return
    text = module_path.read_text()
    if 'resource "aws_route53_record" "app_alias_a"' not in text:
        return

    def ensure_allow_overwrite(resource_name, record_type, source):
        marker = f'resource "aws_route53_record" "{resource_name}" {{'
        start = source.find(marker)
        if start == -1:
            return source
        next_resource = source.find('\nresource "', start + len(marker))
        end = next_resource if next_resource != -1 else len(source)
        block = source[start:end]
        if "allow_overwrite" in block:
            return source
        insert_after = block.find(f'type    = "{record_type}"')
        if insert_after == -1:
            return source
        line_end = block.find("\n", insert_after)
        if line_end == -1:
            return source
        patched_block = block[: line_end + 1] + "  allow_overwrite = true\n" + block[line_end + 1 :]
        return source[:start] + patched_block + source[end:]

    patched = ensure_allow_overwrite("app_alias_a", "A", text)
    patched = ensure_allow_overwrite("app_alias_aaaa", "AAAA", patched)
    if patched != text:
        module_path.write_text(patched)


def stable_json_bytes(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def release_manifest_sha256(manifest):
    return hashlib.sha256(stable_json_bytes(manifest)).hexdigest()


def read_release_manifest(path=MANIFEST):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_release_manifest_digest(path, expected_sha256):
    actual = sha256_file(path)
    expected = (expected_sha256 or "").lower()
    if expected and actual != expected:
        raise RuntimeError(f"Release manifest digest mismatch: expected {expected}, got {actual}")
    manifest = read_release_manifest(path)
    return manifest


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
    start = datetime.fromisoformat(
        require_string(not_before, f"{label}.notBefore").replace("Z", "+00:00")
    )
    end = datetime.fromisoformat(
        require_string(expires_at, f"{label}.expiresAt").replace("Z", "+00:00")
    )
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
        evidence.update(
            verify_release_manifest_signature(manifest, manifest_digest, configured_signature_url)
        )
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


def validate_agentcore_node_runtime(version):
    normalized = str(version or "").strip().removeprefix("v")
    try:
        major = int(normalized.split(".", 1)[0])
    except (TypeError, ValueError):
        raise RuntimeError(
            f"Cannot determine Node.js version for AgentCore runtime: {version}"
        ) from None
    if major < 22:
        raise RuntimeError(
            "AgentCore control runtime requires Node.js 22 or newer; "
            f"deployment runner is using {version}"
        )
    return f"v{normalized}"


def prepare_agentcore_control_runtime():
    global RELEASE_EVIDENCE
    node_version = validate_agentcore_node_runtime(output(["node", "--version"]))
    runner_bundle = bundle_extract_dir({"name": "platform"}) / "runner"
    manifest_path = runner_bundle / "agentcore-control-runtime.json"
    if not manifest_path.is_file():
        raise RuntimeError("Release bundle is missing the AgentCore control runtime manifest")

    runtime_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_sdk = runtime_manifest.get("sdk") or {}
    if (
        expected_sdk.get("package") != "@aws-sdk/client-bedrock-agentcore-control"
        or expected_sdk.get("version") != AGENTCORE_CONTROL_SDK_VERSION
    ):
        raise RuntimeError("Release does not pin the required AgentCore control SDK version")

    runtime_dir = safe_join(
        runner_bundle,
        str(runtime_manifest.get("directory") or "agentcore-control-runtime"),
    )
    if not runtime_dir.is_dir():
        raise RuntimeError("Release bundle has no AgentCore control runtime directory")
    runtime_files = runtime_manifest.get("files") or []
    if not runtime_files:
        raise RuntimeError("AgentCore control runtime manifest has no files")
    runtime_paths = [str(item.get("path") or "") for item in runtime_files]
    required_entrypoints = {
        "harness-lifecycle.js",
        "preflight.js",
        "reconcile_twenty_provider.js",
    }
    required_files = required_entrypoints | {"package.json"}
    if len(runtime_paths) != len(set(runtime_paths)) or not required_files.issubset(runtime_paths):
        raise RuntimeError("AgentCore control runtime manifest has an invalid file set")
    for runtime_file in runtime_files:
        file_path = safe_join(runtime_dir, str(runtime_file.get("path") or ""))
        if not file_path.is_file() or sha256_file(file_path) != runtime_file.get("sha256"):
            raise RuntimeError(
                f"AgentCore control runtime file digest mismatch: {runtime_file.get('path')}"
            )
    actual_runtime_paths = {
        str(path.relative_to(runtime_dir)) for path in runtime_dir.rglob("*") if path.is_file()
    }
    if actual_runtime_paths != set(runtime_paths):
        raise RuntimeError("AgentCore control runtime contains unmanifested or missing files")

    module_boundary = json.loads((runtime_dir / "package.json").read_text(encoding="utf-8"))
    if module_boundary != {"type": "module"}:
        raise RuntimeError("AgentCore control runtime has an invalid ESM module boundary")

    preflight = json.loads(output(["node", str(runtime_dir / "preflight.js")]))
    if preflight != expected_sdk:
        raise RuntimeError("AgentCore control runtime preflight differs from its manifest")
    entrypoint_preflights = [
        json.loads(
            output(
                [
                    "node",
                    str(runtime_dir / entrypoint),
                    "--runtime-preflight",
                ]
            )
        )
        for entrypoint in (
            "harness-lifecycle.js",
            "reconcile_twenty_provider.js",
        )
    ]
    if any(not item.get("sdkImportReady") for item in entrypoint_preflights):
        raise RuntimeError("An AgentCore control runtime entrypoint cannot import its SDK")
    os.environ["THINKWORK_AGENTCORE_CONTROL_RUNTIME_DIR"] = str(runtime_dir)
    evidence = {
        "manifestSha256": sha256_file(manifest_path),
        "sdkPackage": preflight["package"],
        "sdkVersion": preflight["version"],
        "nodeVersion": node_version,
        "bundledEntrypoints": sorted(
            item["path"] for item in runtime_files if item.get("path") in required_entrypoints
        ),
        "bundledRuntimeVerified": True,
        "entrypointPreflights": entrypoint_preflights,
    }
    RELEASE_EVIDENCE["agentCoreControlRuntime"] = evidence
    print(
        "[runner] AgentCore control runtime ready: "
        f"sdk={evidence['sdkVersion']} manifest={evidence['manifestSha256']}"
    )
    return evidence


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


def terraform_plan_delete_addresses(plan_json):
    return [
        change.get("address")
        for change in plan_json.get("resource_changes", [])
        if "delete" in (change.get("change", {}).get("actions") or [])
    ]


def deployment_config_for_approval(payload):
    """Return the immutable deployment intent shared by plan and apply phases.

    Controller/session routing fields necessarily change between executions.
    Everything that can influence the generated Terraform configuration stays
    in this projection, including release pins and preserved configuration.
    """
    reviewed = json.loads(json.dumps(payload))
    for key in [
        "action",
        "phase",
        "sessionId",
        "session",
        "evidence",
        "approvedPlan",
    ]:
        reviewed.pop(key, None)
    operation = reviewed.get("operation")
    if isinstance(operation, dict):
        for key in ["action", "plan", "apply", "approvedPlan"]:
            operation.pop(key, None)
    return reviewed


def deployment_config_sha256(payload):
    return sha256_bytes(stable_json_bytes(deployment_config_for_approval(payload)))


def controller_input_sha256(payload):
    return sha256_bytes(stable_json_bytes(payload))


def raw_controller_input_sha256(payload):
    raw = os.environ.get("THINKWORK_DEPLOYMENT_INPUT")
    if raw:
        return sha256_bytes(raw.encode("utf-8"))
    return controller_input_sha256(payload)


def requested_plan_action(payload, action):
    if action in {"deploy", "update", "destroy"}:
        return action
    operation = payload.get("operation")
    if isinstance(operation, dict):
        candidate = operation.get("targetAction") or operation.get("requestedAction")
        if candidate in {"deploy", "update", "destroy"}:
            return candidate
    if action == "plan":
        return "update"
    return action


def validate_terraform_execution_phase(payload, action):
    """Select the explicit saved-plan protocol or the compatible legacy path.

    The incident recovery always uses separate ``plan`` and ``apply``
    executions. Existing callers still send ``deploy``/``update``/``destroy``
    while their API and CLI approval surfaces are migrated, so those actions
    retain their established combined behavior instead of becoming an
    accidental platform-wide outage.
    """
    operation_value = payload.get("operation")
    operation_is_structured = isinstance(operation_value, dict)
    operation = operation_value
    if not operation_is_structured:
        operation = {}
    requested_apply = operation.get("apply")
    requested_plan = operation.get("plan")

    if action == "apply":
        if requested_apply is not True or requested_plan is not False:
            raise RuntimeError(
                "Saved-plan apply requires operation.apply=true and operation.plan=false"
            )
        approved = payload.get("approvedPlan")
        if not isinstance(approved, dict):
            raise RuntimeError("Saved-plan apply requires approvedPlan")
        return "apply"

    if action in {"deploy", "update", "destroy"}:
        return "legacy"

    if action == "plan":
        if not operation_is_structured:
            # Managed-application jobs predate the structured foundation
            # operation object and already use action=plan as a strict
            # plan-only phase. Preserve that safe contract.
            return "plan"
        if requested_apply is not False:
            raise RuntimeError(
                "Terraform planning never implies approval: operation.apply must be false; "
                "apply the accepted saved plan in a separate action=apply execution"
            )
        if requested_plan is not True:
            raise RuntimeError("Terraform plan phase requires operation.plan=true")
        return "plan"

    return "none"


def terraform_state_identity():
    raw = output(["terraform", "state", "pull"], cwd=TF)
    state = json.loads(raw or "{}")
    lineage = state.get("lineage")
    serial = state.get("serial")
    if not isinstance(lineage, str) or not lineage:
        raise RuntimeError("Terraform state has no lineage; refusing saved-plan operation")
    if not isinstance(serial, int) or serial < 0:
        raise RuntimeError("Terraform state has no valid serial; refusing saved-plan operation")
    return {
        "lineage": lineage,
        "serial": serial,
        "sha256": sha256_bytes(raw.encode("utf-8")),
        "terraformVersion": state.get("terraform_version"),
    }


def _validated_evidence_s3_uri(uri, label):
    parsed = urllib.parse.urlparse(require_string(uri, label))
    expected_bucket = os.environ.get("THINKWORK_EVIDENCE_BUCKET")
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.lstrip("/"):
        raise RuntimeError(f"{label} must be an s3:// evidence URI")
    if expected_bucket and parsed.netloc != expected_bucket:
        raise RuntimeError(f"{label} must use the configured deployment evidence bucket")
    return uri


def _download_approved_artifact(uri, destination, expected_sha256, label):
    _validated_evidence_s3_uri(uri, label)
    expected = require_string(expected_sha256, f"{label}.sha256").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise RuntimeError(f"{label}.sha256 must be a lowercase SHA-256 digest")
    run(["aws", "s3", "cp", uri, str(destination)])
    actual = sha256_file(destination)
    if actual != expected:
        raise RuntimeError(f"{label} digest mismatch: expected {expected}, got {actual}")
    return actual


def load_approved_plan_descriptor(payload):
    approved = payload.get("approvedPlan")
    if not isinstance(approved, dict):
        raise RuntimeError("Saved-plan apply requires approvedPlan")
    descriptor_ref = approved.get("descriptor")
    if not isinstance(descriptor_ref, dict):
        raise RuntimeError("approvedPlan.descriptor is required")
    descriptor_path = WORK / TERRAFORM_PLAN_DESCRIPTOR_NAME
    _download_approved_artifact(
        descriptor_ref.get("s3Uri"),
        descriptor_path,
        descriptor_ref.get("sha256"),
        "approvedPlan.descriptor",
    )
    descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
    if descriptor.get("contract") != TERRAFORM_PLAN_APPROVAL_CONTRACT:
        raise RuntimeError("Approved plan descriptor contract is unsupported")
    return descriptor, descriptor_ref


def validate_and_materialize_approved_plan(payload, state_identity):
    descriptor, descriptor_ref = load_approved_plan_descriptor(payload)
    if descriptor.get("deploymentConfigSha256") != deployment_config_sha256(payload):
        raise RuntimeError("Approved plan deployment configuration does not match apply input")
    if descriptor.get("release") != release_selection(payload):
        raise RuntimeError("Approved plan release pin does not match apply input")
    if descriptor.get("state") != state_identity:
        raise RuntimeError("Terraform state changed after plan approval; refusing apply")

    tfvars_sha256 = sha256_file(TF / "terraform.auto.tfvars.json")
    if descriptor.get("terraformVariablesSha256") != tfvars_sha256:
        raise RuntimeError("Approved plan Terraform variables do not match apply execution")

    saved_plan = descriptor.get("savedPlan")
    plan_json = descriptor.get("jsonPlan")
    if not isinstance(saved_plan, dict) or not isinstance(plan_json, dict):
        raise RuntimeError("Approved plan descriptor is missing saved plan artifacts")
    destination = TF / "tfplan"
    _download_approved_artifact(
        saved_plan.get("s3Uri"),
        destination,
        saved_plan.get("sha256"),
        "approvedPlan.savedPlan",
    )
    accepted_json = WORK / "accepted-terraform-plan.json"
    _download_approved_artifact(
        plan_json.get("s3Uri"),
        accepted_json,
        plan_json.get("sha256"),
        "approvedPlan.jsonPlan",
    )
    rendered = WORK / "approved-terraform-plan.json"
    with rendered.open("w", encoding="utf-8") as handle:
        run(["terraform", "show", "-json", "tfplan"], cwd=TF, stdout=handle)
    accepted_plan = json.loads(accepted_json.read_text(encoding="utf-8"))
    rendered_plan = json.loads(rendered.read_text(encoding="utf-8"))
    if rendered_plan != accepted_plan:
        raise RuntimeError("Approved saved plan no longer renders to the accepted JSON plan")
    if payload.get("incidentRecovery") is not None:
        delete_addresses = terraform_plan_delete_addresses(rendered_plan)
        if delete_addresses:
            raise RuntimeError(
                "TEI v380 recovery approved plan contains delete actions; refusing apply"
            )

    return {
        "descriptor": {
            "fileName": TERRAFORM_PLAN_DESCRIPTOR_NAME,
            "sha256": descriptor_ref.get("sha256"),
            "s3Uri": descriptor_ref.get("s3Uri"),
        },
        "savedPlan": saved_plan,
        "jsonPlan": plan_json,
        "summary": descriptor.get("summary"),
        "plannedAction": descriptor.get("plannedAction"),
        "sourceSessionId": descriptor.get("sessionId"),
        "state": state_identity,
    }


def managed_app_terraform_target_args(payload):
    app_key = payload.get("appKey")
    if app_key == "n8n":
        return [
            "-target=module.thinkwork.terraform_data.n8n_configuration_guardrails",
            "-target=module.thinkwork.module.n8n",
            "-target=aws_acm_certificate.n8n",
            "-target=cloudflare_record.n8n_acm_validation",
            "-target=aws_acm_certificate_validation.n8n",
            "-target=cloudflare_record.n8n",
        ]
    return []


def execute_terraform_plan_phase(
    payload,
    state_identity,
    planned_action,
    terraform_phase,
    target_args,
):
    """Create plan evidence and apply only for the compatible legacy phase."""
    plan_args = ["terraform", "plan"]
    if planned_action == "destroy":
        plan_args.append("-destroy")
    plan_args.extend([*target_args, "-out=tfplan", "-no-color"])
    plan = subprocess.run(plan_args, cwd=TF, text=True)
    if plan.returncode != 0:
        return plan
    TERRAFORM_EVIDENCE["plan"] = write_terraform_plan_evidence(
        payload,
        state_identity,
        planned_action,
    )
    if terraform_phase != "legacy":
        return plan
    return subprocess.run(
        ["terraform", "apply", "-auto-approve", "-no-color", "tfplan"],
        cwd=TF,
        text=True,
    )


def should_reconcile_native_auth_schema(terraform_phase, planned_action, payload):
    return (
        terraform_phase in {"apply", "legacy"}
        and planned_action in {"deploy", "update"}
        and not is_managed_app_operation(payload)
    )


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
        return {"status": "skipped", "reason": "not-managed-app"}
    print("[runner] refreshing Terraform outputs after targeted managed-app apply")
    command = [
        "terraform",
        "apply",
        "-refresh-only",
        "-auto-approve",
        "-no-color",
    ]
    try:
        run(command, cwd=TF)
    except subprocess.CalledProcessError as error:
        detail = {
            "status": "failed",
            "command": [str(part) for part in command],
            "exitCode": error.returncode,
            "nonFatal": True,
        }
        TERRAFORM_EVIDENCE["outputRefresh"] = detail
        print(
            f"[runner] managed-app output refresh failed after targeted apply (non-fatal): {error}"
        )
        return detail
    detail = {"status": "succeeded", "command": [str(part) for part in command]}
    TERRAFORM_EVIDENCE["outputRefresh"] = detail
    return detail


def write_outputs_after_apply(payload, vars_json, outputs_path):
    refresh_outputs_after_targeted_apply(payload)
    try:
        outputs_path.write_text(output(["terraform", "output", "-json"], cwd=TF), encoding="utf-8")
        source = "terraform-output"
    except Exception as error:
        if not is_managed_app_operation(payload):
            raise
        outputs = current_terraform_outputs(str(vars_json.get("stage") or ""))
        if not outputs:
            TERRAFORM_EVIDENCE["outputs"] = {
                "status": "unavailable",
                "source": "state",
                "error": str(error),
            }
            print(
                "[runner] managed-app Terraform outputs unavailable after targeted apply "
                f"(non-fatal): {error}"
            )
            return
        outputs_path.write_text(
            json.dumps(outputs, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        TERRAFORM_EVIDENCE["outputReadFallback"] = {
            "status": "succeeded",
            "source": "state",
            "reason": str(error),
        }
        source = "state"
    TERRAFORM_EVIDENCE["outputs"] = {
        "fileName": "terraform-outputs.json",
        "sha256": sha256_file(outputs_path),
        "s3Uri": upload_evidence_artifact(outputs_path, "terraform-outputs.json"),
        "source": source,
    }


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


def release_sync_request(action, payload, identity_operation):
    if (
        action not in {"deploy", "update", "web"}
        or is_managed_app_operation(payload)
        or identity_operation is not None
    ):
        return None
    web_only = is_web_only_operation(payload, action)
    return {
        "artifact_types": {"static-site"} if web_only else None,
        "artifact_names": {"web"} if web_only else None,
    }


def requires_agentcore_control_runtime(action, payload, identity_operation):
    return (
        action in {"deploy", "update", "plan", "destroy"}
        and not is_managed_app_operation(payload)
        and identity_operation is None
    )


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
    app_key = payload.get("appKey")
    if app_key != "n8n":
        return
    allowed_prefixes = [
        "module.thinkwork.module.n8n",
        "module.thinkwork.terraform_data.n8n_configuration_guardrails",
        "module.thinkwork.terraform_data.n8n_runtime_state_guardrails",
        "aws_acm_certificate.n8n",
        "cloudflare_record.n8n_acm_validation",
        "aws_acm_certificate_validation.n8n",
        "cloudflare_record.n8n",
    ]
    unsafe_changes = []
    for change in plan_json.get("resource_changes", []):
        actions = change.get("change", {}).get("actions", [])
        if not actions or actions == ["no-op"] or actions == ["read"]:
            continue
        address = change.get("address", "")
        if any(address.startswith(prefix) for prefix in allowed_prefixes):
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
            f"Managed app plan for {app_key} contains non-{app_key} changes; "
            "refusing to continue. "
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

        if address.startswith(
            "module.thinkwork.module.customer_domain."
        ) and destructive_plan_actions(actions):
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


def write_terraform_plan_evidence(payload=None, state_identity=None, planned_action="update"):
    payload = payload or {}
    state_identity = state_identity or terraform_state_identity()
    plan_path = Path("terraform-plan.json")
    with plan_path.open("w", encoding="utf-8") as handle:
        run(["terraform", "show", "-json", "tfplan"], cwd=TF, stdout=handle)
    plan_json = json.loads(plan_path.read_text(encoding="utf-8"))
    validate_managed_app_plan_scope(payload, plan_json)
    validate_environment_plan_scope(payload, plan_json)
    artifact = {
        "fileName": plan_path.name,
        "sha256": sha256_file(plan_path),
        "s3Uri": upload_evidence_artifact(plan_path),
    }
    saved_plan_path = TF / "tfplan"
    saved_plan = {
        "fileName": TERRAFORM_SAVED_PLAN_NAME,
        "sha256": sha256_file(saved_plan_path),
        "s3Uri": upload_evidence_artifact(saved_plan_path, TERRAFORM_SAVED_PLAN_NAME),
    }
    descriptor = {
        "schemaVersion": 1,
        "contract": TERRAFORM_PLAN_APPROVAL_CONTRACT,
        "createdAt": datetime.now(UTC).isoformat(),
        "status": "awaiting-approval",
        "sessionId": payload.get("sessionId") or os.environ.get("THINKWORK_DEPLOYMENT_SESSION_ID"),
        "plannedAction": planned_action,
        "controllerInputSha256": controller_input_sha256(payload),
        "rawControllerInputSha256": raw_controller_input_sha256(payload),
        "deploymentConfigSha256": deployment_config_sha256(payload),
        "terraformVariablesSha256": sha256_file(TF / "terraform.auto.tfvars.json"),
        "release": release_selection(payload),
        "state": state_identity,
        "jsonPlan": artifact,
        "savedPlan": saved_plan,
        "summary": terraform_plan_summary(plan_json),
    }
    descriptor_artifact = write_json_evidence_artifact(
        TERRAFORM_PLAN_DESCRIPTOR_NAME,
        descriptor,
    )
    return {
        "artifact": artifact,
        "savedPlan": saved_plan,
        "approvalDescriptor": descriptor_artifact,
        "summary": descriptor["summary"],
        "state": state_identity,
        "status": "awaiting-approval",
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


def _terraform_state_object_keys(stage):
    return [
        f"env:/{stage}/thinkwork/{stage}/terraform.tfstate",
        f"thinkwork/{stage}/terraform.tfstate",
    ]


def terraform_state_object_snapshot(stage):
    bucket = require_string(
        os.environ.get("THINKWORK_TERRAFORM_STATE_BUCKET"),
        "THINKWORK_TERRAFORM_STATE_BUCKET",
    )
    for key in _terraform_state_object_keys(stage):
        try:
            head = json.loads(
                output(
                    [
                        "aws",
                        "s3api",
                        "head-object",
                        "--bucket",
                        bucket,
                        "--key",
                        key,
                        "--output",
                        "json",
                    ]
                )
            )
            body = subprocess.check_output(
                ["aws", "s3", "cp", f"s3://{bucket}/{key}", "-"],
            )
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            continue
        state = json.loads(body)
        return {
            "bucket": bucket,
            "key": key,
            "etag": str(head.get("ETag") or "").strip('"'),
            "size": int(head.get("ContentLength") or len(body)),
            "lastModified": head.get("LastModified"),
            "serverSideEncryption": head.get("ServerSideEncryption"),
            "versionId": head.get("VersionId"),
            "sha256": sha256_bytes(body),
            "lineage": state.get("lineage"),
            "serial": state.get("serial"),
            "terraformVersion": state.get("terraform_version"),
        }
    raise RuntimeError(f"Terraform state object for stage {stage} was not found")


def _incident_operation(payload):
    operation = payload.get("operation")
    if not isinstance(operation, dict) or operation.get("kind") != "incident_recovery":
        raise RuntimeError("Incident recovery requires operation.kind=incident_recovery")
    return operation


def _require_exact_incident_payload_aliases(payload, aliases, expected, label):
    present = {name: payload.get(name) for name in aliases if name in payload}
    if not present or any(value != expected for value in present.values()):
        raise RuntimeError(f"TEI v380 recovery {label} does not match exact incident scope")


def tei_v380_recovery_scope():
    return {
        "contract": TEI_V380_RECOVERY_CONTRACT,
        "incidentId": TEI_V380_RECOVERY_INCIDENT_ID,
        "rejectedPlanSha256": TEI_V380_REJECTED_PLAN_SHA256,
        "stage": "tei-e2e",
        "accountId": "637423202447",
        "region": "us-east-1",
        "state": {
            "bucket": TEI_V380_STATE_BUCKET,
            "key": TEI_V380_STATE_KEY,
            "lineage": TEI_V380_STATE_LINEAGE,
            "serial": TEI_V380_STATE_SERIAL,
            "sha256": TEI_V380_STATE_SHA256,
        },
        "lock": {
            "table": TEI_V380_LOCK_TABLE,
            "key": TEI_V380_LOCK_KEY,
            "id": TEI_V380_LOCK_ID,
            "operation": "OperationTypeApply",
            "terraformVersion": "1.8.5",
            "digest": TEI_V380_STATE_DIGEST,
        },
        "secret": {
            "address": TEI_V380_SECRET_ADDRESS,
            "arn": TEI_V380_SECRET_ARN,
            "name": TEI_V380_SECRET_NAME,
        },
        "kmsKey": {
            "address": TEI_V380_KMS_KEY_ADDRESS,
            "id": TEI_V380_KMS_KEY_ID,
            "arn": TEI_V380_KMS_KEY_ARN,
            "aliasAddress": TEI_V380_KMS_ALIAS_ADDRESS,
            "alias": TEI_V380_KMS_ALIAS,
        },
    }


def validate_tei_v380_recovery_contract(payload):
    operation = _incident_operation(payload)
    expected = tei_v380_recovery_scope()
    actual = {
        key: operation.get(key)
        for key in [
            "contract",
            "incidentId",
            "rejectedPlanSha256",
            "stage",
            "accountId",
            "region",
            "state",
            "lock",
            "secret",
            "kmsKey",
        ]
    }
    if actual != expected:
        raise RuntimeError("TEI v380 recovery contract does not match the exact incident scope")
    expected_operation_keys = {"kind", *expected.keys()}
    if set(operation) != expected_operation_keys:
        raise RuntimeError("TEI v380 recovery operation contains unexpected fields")
    _require_exact_incident_payload_aliases(
        payload, ("environmentName", "stage"), "tei-e2e", "stage"
    )
    _require_exact_incident_payload_aliases(
        payload, ("awsAccountId", "accountId"), "637423202447", "account"
    )
    _require_exact_incident_payload_aliases(payload, ("awsRegion", "region"), "us-east-1", "region")
    return expected


def assert_incident_recovery_operation_is_exclusive():
    current_execution = os.environ.get("THINKWORK_DEPLOYMENT_EXECUTION_ARN")
    state_machine_arn = require_string(
        os.environ.get("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN"),
        "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
    )
    executions = json.loads(
        output(
            [
                "aws",
                "stepfunctions",
                "list-executions",
                "--state-machine-arn",
                state_machine_arn,
                "--status-filter",
                "RUNNING",
                "--output",
                "json",
            ]
        )
        or "{}"
    ).get("executions", [])
    if current_execution:
        other_executions = [
            item.get("executionArn")
            for item in executions
            if item.get("executionArn") != current_execution
        ]
    else:
        # Established control planes do not receive Execution.Id until this
        # release updates their state-machine definition. Permit exactly the
        # sole running controller execution during that bounded transition.
        # Zero executions would mean the recovery was launched outside the
        # managed controller; more than one is ambiguous and unsafe.
        if len(executions) != 1:
            raise RuntimeError(
                "Incident recovery without execution identity requires exactly one "
                "running deployment execution"
            )
        current_execution = executions[0].get("executionArn")
        other_executions = []
    if other_executions:
        raise RuntimeError("Another deployment execution is running; recovery refused")

    project = require_string(
        os.environ.get("THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME"),
        "THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME",
    )
    current_build = os.environ.get("CODEBUILD_BUILD_ID")
    if not current_build:
        raise RuntimeError("Incident recovery must run inside the deployment CodeBuild")
    build_ids = json.loads(
        output(
            [
                "aws",
                "codebuild",
                "list-builds-for-project",
                "--project-name",
                project,
                "--sort-order",
                "DESCENDING",
                "--no-paginate",
                "--output",
                "json",
            ]
        )
        or "{}"
    ).get("ids", [])[:100]
    if build_ids:
        builds = json.loads(
            output(
                [
                    "aws",
                    "codebuild",
                    "batch-get-builds",
                    "--ids",
                    *build_ids,
                    "--output",
                    "json",
                ]
            )
            or "{}"
        ).get("builds", [])
        other_builds = [
            item.get("id")
            for item in builds
            if item.get("buildStatus") == "IN_PROGRESS" and item.get("id") != current_build
        ]
        if other_builds:
            raise RuntimeError("Another deployment CodeBuild is running; recovery refused")
    return {
        "currentExecutionArn": current_execution,
        "currentBuildId": current_build,
        "otherRunningExecutions": 0,
        "otherRunningBuilds": 0,
    }


def _redacted_secret_description(description):
    return {
        "arn": description.get("ARN"),
        "name": description.get("Name"),
        "deletedDate": description.get("DeletedDate"),
        "kmsKeyId": description.get("KmsKeyId"),
        "rotationEnabled": bool(description.get("RotationEnabled", False)),
    }


def _redacted_kms_description(description):
    metadata = description.get("KeyMetadata") or {}
    return {
        "keyId": metadata.get("KeyId"),
        "arn": metadata.get("Arn"),
        "keyState": metadata.get("KeyState"),
        "deletionDate": metadata.get("DeletionDate"),
        "enabled": metadata.get("Enabled"),
        "keyManager": metadata.get("KeyManager"),
        "origin": metadata.get("Origin"),
    }


def _wait_for_json_description(fetch, accept, description, attempts=20, delay_seconds=1):
    """Bound eventual-consistency waits without ever reading secret values."""
    latest = None
    for attempt in range(attempts):
        latest = fetch()
        if accept(latest):
            return latest
        if attempt + 1 < attempts:
            time.sleep(delay_seconds)
    raise RuntimeError(f"Timed out waiting for {description}")


def _dynamodb_string(item, name):
    value = (item.get(name) or {}).get("S")
    return value if isinstance(value, str) else None


def tei_v380_lock_snapshot():
    def get_item(lock_key):
        raw = output(
            [
                "aws",
                "dynamodb",
                "get-item",
                "--table-name",
                TEI_V380_LOCK_TABLE,
                "--key",
                json.dumps({"LockID": {"S": lock_key}}, separators=(",", ":")),
                "--consistent-read",
                "--output",
                "json",
            ]
        )
        return json.loads(raw or "{}").get("Item") or {}

    lock_item = get_item(TEI_V380_LOCK_KEY)
    digest_item = get_item(f"{TEI_V380_LOCK_KEY}-md5")
    info_raw = _dynamodb_string(lock_item, "Info")
    info = json.loads(info_raw) if info_raw else None
    if info is not None and not isinstance(info, dict):
        raise RuntimeError("TEI v380 Terraform lock Info is malformed")
    return {
        "table": TEI_V380_LOCK_TABLE,
        "key": TEI_V380_LOCK_KEY,
        "present": bool(lock_item),
        "info": {
            "id": (info or {}).get("ID"),
            "operation": (info or {}).get("Operation"),
            "version": (info or {}).get("Version"),
            "created": (info or {}).get("Created"),
            "path": (info or {}).get("Path"),
        }
        if info
        else None,
        "digestKey": f"{TEI_V380_LOCK_KEY}-md5",
        "digest": _dynamodb_string(digest_item, "Digest"),
    }


def force_unlock_tei_v380_state():
    """Use Terraform's backend-aware unlock path; never delete DynamoDB rows directly."""
    before = tei_v380_lock_snapshot()
    expected_info = {
        "id": TEI_V380_LOCK_ID,
        "operation": "OperationTypeApply",
        "version": "1.8.5",
        "path": TEI_V380_LOCK_KEY,
    }
    actual_info = before.get("info") or {}
    if before.get("digest") != TEI_V380_STATE_DIGEST:
        raise RuntimeError("TEI v380 Terraform state digest changed; unlock refused")
    if before.get("present") is not True:
        return {
            "method": "terraform-force-unlock",
            "lockId": TEI_V380_LOCK_ID,
            "before": before,
            "after": before,
            "alreadyUnlocked": True,
            "directDynamoDbMutation": False,
        }
    if any(actual_info.get(key) != value for key, value in expected_info.items()):
        raise RuntimeError("TEI v380 stale Terraform lock identity does not match")

    unlock_dir = WORK / "tei-v380-force-unlock"
    unlock_dir.mkdir(parents=True, exist_ok=True)
    (unlock_dir / "main.tf").write_text(
        'terraform {\n  required_version = ">= 1.8.5"\n  backend "s3" {}\n}\n',
        encoding="utf-8",
    )
    (unlock_dir / "backend.hcl").write_text(
        "\n".join(
            [
                f"bucket = {hcl_string(TEI_V380_STATE_BUCKET)}",
                f"key = {hcl_string(TEI_V380_STATE_KEY)}",
                'region = "us-east-1"',
                f"dynamodb_table = {hcl_string(TEI_V380_LOCK_TABLE)}",
                "encrypt = true",
                "",
            ]
        ),
        encoding="utf-8",
    )
    run(
        [
            "terraform",
            "init",
            "-reconfigure",
            "-backend-config=backend.hcl",
            "-input=false",
            "-no-color",
        ],
        cwd=unlock_dir,
    )
    run(
        ["terraform", "force-unlock", "-force", TEI_V380_LOCK_ID],
        cwd=unlock_dir,
    )
    after = tei_v380_lock_snapshot()
    if after.get("present") is not False:
        raise RuntimeError("TEI v380 stale Terraform lock remains after force-unlock")
    if after.get("digest") != before.get("digest"):
        raise RuntimeError("Terraform state digest changed during force-unlock")
    return {
        "method": "terraform-force-unlock",
        "lockId": TEI_V380_LOCK_ID,
        "before": before,
        "after": after,
        "alreadyUnlocked": False,
        "directDynamoDbMutation": False,
    }


def recover_tei_v380_incident(payload):
    validate_tei_v380_recovery_contract(payload)
    exclusivity = assert_incident_recovery_operation_is_exclusive()
    caller_account = output(
        ["aws", "sts", "get-caller-identity", "--query", "Account", "--output", "text"]
    )
    if caller_account != "637423202447":
        raise RuntimeError("TEI v380 recovery caller is in the wrong AWS account")

    before_state = terraform_state_object_snapshot("tei-e2e")
    for key, expected in [
        ("bucket", TEI_V380_STATE_BUCKET),
        ("key", TEI_V380_STATE_KEY),
        ("lineage", TEI_V380_STATE_LINEAGE),
        ("serial", TEI_V380_STATE_SERIAL),
        ("sha256", TEI_V380_STATE_SHA256),
    ]:
        if before_state.get(key) != expected:
            raise RuntimeError(f"TEI v380 recovery state {key} changed; recovery refused")

    progress = {
        "schemaVersion": 1,
        "contract": TEI_V380_RECOVERY_CONTRACT,
        "incidentId": TEI_V380_RECOVERY_INCIDENT_ID,
        "rejectedPlanSha256": TEI_V380_REJECTED_PLAN_SHA256,
        "status": "preflight-passed",
        "startedAt": datetime.now(UTC).isoformat(),
        "exclusiveOperation": exclusivity,
        "stateBefore": before_state,
        "terraformStateMutation": False,
        "secretValueRead": False,
    }
    write_json_evidence_artifact("incident-recovery-progress.json", progress)

    secret_before_raw = json.loads(
        output(
            [
                "aws",
                "secretsmanager",
                "describe-secret",
                "--secret-id",
                TEI_V380_SECRET_ARN,
                "--output",
                "json",
            ]
        )
    )
    if (
        secret_before_raw.get("ARN") != TEI_V380_SECRET_ARN
        or secret_before_raw.get("Name") != TEI_V380_SECRET_NAME
    ):
        raise RuntimeError("TEI v380 recovery secret identity does not match")
    if secret_before_raw.get("DeletedDate"):
        run(
            [
                "aws",
                "secretsmanager",
                "restore-secret",
                "--secret-id",
                TEI_V380_SECRET_ARN,
            ],
            stdout=subprocess.DEVNULL,
        )

    def describe_secret():
        return json.loads(
            output(
                [
                    "aws",
                    "secretsmanager",
                    "describe-secret",
                    "--secret-id",
                    TEI_V380_SECRET_ARN,
                    "--output",
                    "json",
                ]
            )
        )

    secret_after_raw = _wait_for_json_description(
        describe_secret,
        lambda value: not value.get("DeletedDate"),
        "restored TEI Twenty OAuth client secret",
    )
    if (
        secret_after_raw.get("ARN") != TEI_V380_SECRET_ARN
        or secret_after_raw.get("Name") != TEI_V380_SECRET_NAME
    ):
        raise RuntimeError("Restored TEI v380 recovery secret identity does not match")
    progress["secret"] = {
        "address": TEI_V380_SECRET_ADDRESS,
        "before": _redacted_secret_description(secret_before_raw),
        "after": _redacted_secret_description(secret_after_raw),
        "status": "restored",
    }
    progress["status"] = "secret-restored"
    write_json_evidence_artifact("incident-recovery-progress.json", progress)

    kms_before_raw = json.loads(
        output(
            [
                "aws",
                "kms",
                "describe-key",
                "--key-id",
                TEI_V380_KMS_KEY_ID,
                "--output",
                "json",
            ]
        )
    )
    kms_before = _redacted_kms_description(kms_before_raw)
    if (
        kms_before.get("keyId") != TEI_V380_KMS_KEY_ID
        or kms_before.get("arn") != TEI_V380_KMS_KEY_ARN
    ):
        raise RuntimeError("TEI v380 recovery KMS key identity does not match")
    if kms_before.get("keyState") == "PendingDeletion":
        run(
            ["aws", "kms", "cancel-key-deletion", "--key-id", TEI_V380_KMS_KEY_ID],
            stdout=subprocess.DEVNULL,
        )

    def describe_kms_key():
        return json.loads(
            output(
                [
                    "aws",
                    "kms",
                    "describe-key",
                    "--key-id",
                    TEI_V380_KMS_KEY_ID,
                    "--output",
                    "json",
                ]
            )
        )

    kms_mid_raw = _wait_for_json_description(
        describe_kms_key,
        lambda value: _redacted_kms_description(value).get("keyState") in {"Disabled", "Enabled"},
        "cancelled TEI turn-assertion KMS deletion",
    )
    if _redacted_kms_description(kms_mid_raw).get("keyState") == "Disabled":
        run(
            ["aws", "kms", "enable-key", "--key-id", TEI_V380_KMS_KEY_ID],
            stdout=subprocess.DEVNULL,
        )
    kms_after_raw = _wait_for_json_description(
        describe_kms_key,
        lambda value: (
            _redacted_kms_description(value).get("keyState") == "Enabled"
            and _redacted_kms_description(value).get("enabled") is True
        ),
        "enabled TEI turn-assertion KMS key",
    )
    kms_after = _redacted_kms_description(kms_after_raw)
    if (
        kms_after.get("keyId") != TEI_V380_KMS_KEY_ID
        or kms_after.get("arn") != TEI_V380_KMS_KEY_ARN
    ):
        raise RuntimeError("Recovered TEI v380 KMS key identity does not match")
    progress["kmsKey"] = {
        "address": TEI_V380_KMS_KEY_ADDRESS,
        "aliasAddress": TEI_V380_KMS_ALIAS_ADDRESS,
        "alias": TEI_V380_KMS_ALIAS,
        "before": kms_before,
        "after": kms_after,
        "status": "enabled",
    }
    progress["status"] = "resources-recovered"
    write_json_evidence_artifact("incident-recovery-progress.json", progress)

    progress["terraformLock"] = force_unlock_tei_v380_state()
    progress["status"] = "resources-recovered-and-state-unlocked"
    write_json_evidence_artifact("incident-recovery-progress.json", progress)

    after_state = terraform_state_object_snapshot("tei-e2e")
    if after_state != before_state:
        raise RuntimeError("Terraform state object changed during incident recovery")
    progress.update(
        {
            "status": "succeeded",
            "completedAt": datetime.now(UTC).isoformat(),
            "stateAfter": after_state,
            "terraformStateMutation": False,
            "secretValueRead": False,
            "nextStep": "proof-enabled-plan-with-imports",
        }
    )
    artifact = write_json_evidence_artifact("incident-recovery.json", progress)
    return {"proof": progress, "artifact": artifact}


def tei_v380_recovery_import_blocks(payload, vars_json):
    recovery = payload.get("incidentRecovery")
    if recovery is None:
        return ""
    if not isinstance(recovery, dict):
        raise RuntimeError("incidentRecovery must be an object")
    evidence_ref = recovery.get("evidence")
    actual_scope = {key: recovery.get(key) for key in tei_v380_recovery_scope()}
    if actual_scope != tei_v380_recovery_scope():
        raise RuntimeError("Incident recovery import scope does not match TEI v380 incident")
    if not isinstance(evidence_ref, dict):
        raise RuntimeError("incidentRecovery.evidence is required")

    # The decoded Terraform state is used elsewhere to preserve outputs and
    # guardrails, but it does not carry an object digest. Recovery approval is
    # explicitly bound to the S3 state object's SHA/lineage/serial, so compare
    # against the authoritative object snapshot instead of the decoded state.
    current_state = terraform_state_object_snapshot(
        vars_json.get("stage") or recovery.get("stage") or ""
    )

    evidence_path = WORK / "accepted-incident-recovery.json"
    _download_approved_artifact(
        evidence_ref.get("s3Uri"),
        evidence_path,
        evidence_ref.get("sha256"),
        "incidentRecovery.evidence",
    )
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    if (
        evidence.get("contract") != TEI_V380_RECOVERY_CONTRACT
        or evidence.get("incidentId") != TEI_V380_RECOVERY_INCIDENT_ID
        or evidence.get("rejectedPlanSha256") != TEI_V380_REJECTED_PLAN_SHA256
        or evidence.get("status") != "succeeded"
        or evidence.get("terraformStateMutation") is not False
        or evidence.get("secretValueRead") is not False
        or evidence.get("stateBefore") != evidence.get("stateAfter")
    ):
        raise RuntimeError("Incident recovery evidence is incomplete or unsafe")
    evidence_state = evidence.get("stateAfter") or {}
    if (
        evidence_state.get("lineage") != TEI_V380_STATE_LINEAGE
        or evidence_state.get("serial") != TEI_V380_STATE_SERIAL
        or evidence_state.get("sha256") != TEI_V380_STATE_SHA256
    ):
        raise RuntimeError("Incident recovery evidence state identity does not match")
    if (
        current_state.get("lineage") != TEI_V380_STATE_LINEAGE
        or current_state.get("serial") != TEI_V380_STATE_SERIAL
        or current_state.get("sha256") != TEI_V380_STATE_SHA256
    ):
        raise RuntimeError("Current Terraform state moved after incident recovery")

    if vars_json.get("enable_agentcore_multiplayer_proof") is not True:
        raise RuntimeError("Incident recovery import requires AgentCore proof enabled")
    if vars_json.get("agentcore_multiplayer_proof_tenant_slug") != "tei":
        raise RuntimeError("Incident recovery import requires the exact TEI tenant slug")
    if vars_json.get("agentcore_multiplayer_proof_owner_allowlist") != TEI_V380_OWNER_ALLOWLIST:
        raise RuntimeError("Incident recovery import requires the exact owner allowlist")
    if vars_json.get("finalize_auth_retirement") is not False:
        raise RuntimeError("Incident recovery import cannot finalize auth retirement")
    if vars_json.get("auth_retirement_phase") != "coexistence":
        raise RuntimeError("Incident recovery import requires auth coexistence")
    if vars_json.get("microsoft_oauth_tenant") != "organizations":
        raise RuntimeError("Incident recovery import requires Microsoft organizations tenant")

    return f"""
# TEI v380 incident recovery imports. These addresses and IDs are bound to the
# independently accepted recovery evidence above. They recover ownership of
# the original secret and KMS key without reading or replacing either value.
import {{
  to = {TEI_V380_SECRET_ADDRESS}
  id = {hcl_string(TEI_V380_SECRET_ARN)}
}}

import {{
  to = {TEI_V380_KMS_KEY_ADDRESS}
  id = {hcl_string(TEI_V380_KMS_KEY_ID)}
}}
"""


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


def has_state_output(outputs, name):
    value = outputs.get(name)
    return isinstance(value, dict) and "value" in value


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
        vars_json["customer_domain"] = previous_domain
        vars_json["customer_domain_delegated"] = (
            bool_state_output(current_outputs, "customer_domain_delegated")
            if has_state_output(current_outputs, "customer_domain_delegated")
            else True
        )
        vars_json["customer_domain_legacy_retired"] = bool_state_output(
            current_outputs, "customer_domain_legacy_retired"
        )
        return

    if next_domain != previous_domain and not allow_removal:
        raise RuntimeError(
            "Refusing to change customer_domain during a controller update. "
            f"Current Terraform state has {previous_domain!r}, but this run "
            f"generated {next_domain!r}. Domain changes require an explicit, "
            "reviewed domain migration with allowCustomerDomainRemoval=true."
        )

    previous_delegated = (
        bool_state_output(current_outputs, "customer_domain_delegated")
        if has_state_output(current_outputs, "customer_domain_delegated")
        else True
    )
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


def state_root_resource_attributes(state, rtype, name):
    for resource in state.get("resources", []) or []:
        if resource.get("module"):
            continue
        if resource.get("type") != rtype or resource.get("name") != name:
            continue
        for instance in resource.get("instances", []) or []:
            attributes = instance.get("attributes")
            if isinstance(attributes, dict):
                return attributes
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


def n8n_binary_data_mode(value):
    if isinstance(value, str) and value.strip() == "database":
        return "default"
    return value


def config_bool(desired_config, key, env_name, default=False):
    value = desired_config.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value:
        return truthy(value)
    env_value = os.environ.get(env_name)
    if env_value:
        return truthy(env_value)
    return default


def config_int(desired_config, key, env_name, default):
    value = desired_config.get(key)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value:
        return int(value)
    env_value = os.environ.get(env_name)
    if env_value:
        return int(env_value)
    return default


def config_string_list(desired_config, key, env_name, default=None):
    value = desired_config.get(key)
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [item.strip() for item in value.split(",") if item.strip()]
    env_value = os.environ.get(env_name)
    if env_value:
        return [item.strip() for item in env_value.split(",") if item.strip()]
    return list(default or [])


def required_config_value(
    desired_config,
    manifest_images,
    key,
    env_name,
    label,
    image_names=None,
    default="",
    app_label="n8n",
):
    value = config_value(desired_config, manifest_images, key, env_name, image_names, default)
    if isinstance(value, str) and value:
        return value
    raise RuntimeError(
        f"{app_label} managed app operation is missing required desired-state field: {label}."
    )


def twenty_public_url_from_domain(domain):
    if not isinstance(domain, str) or not domain.strip():
        return ""
    value = domain.strip()
    if value.startswith("http://") or value.startswith("https://"):
        return value.rstrip("/")
    hostname = value if value.startswith("crm.") else f"crm.{value}"
    return f"https://{hostname}".rstrip("/")


def n8n_public_url_from_domain(domain):
    if not isinstance(domain, str) or not domain.strip():
        return ""
    value = domain.strip()
    if value.startswith("http://") or value.startswith("https://"):
        return value.rstrip("/")
    hostname = value if value.startswith("n8n.") else f"n8n.{value}"
    return f"https://{hostname}".rstrip("/")


def sibling_app_base_domain(public_url):
    hostname = url_hostname(public_url)
    if not hostname:
        return ""
    labels = hostname.split(".")
    if len(labels) <= 2:
        return hostname
    return ".".join(labels[1:])


def first_non_empty_string(*values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def canonical_json(value):
    if value is None or not isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    return (
        "{"
        + ",".join(
            json.dumps(key, separators=(",", ":")) + ":" + canonical_json(value[key])
            for key in sorted(value.keys())
        )
        + "}"
    )


def normalize_n8n_package_config(desired_config):
    specs = config_string_list(
        desired_config,
        "customPackageSpecs",
        "THINKWORK_N8N_CUSTOM_PACKAGE_SPECS",
    )
    by_name = {}
    for raw_spec in specs:
        if re.search(r"\s", raw_spec) or "://" in raw_spec:
            raise RuntimeError(
                f'n8n custom package "{raw_spec}" must be an exact public npm package spec.'
            )
        if raw_spec.startswith(("./", "../", "/")) or raw_spec.endswith(".tgz"):
            raise RuntimeError(
                f'n8n custom package "{raw_spec}" must be resolved from the public npm registry.'
            )
        version_separator_index = raw_spec.rfind("@")
        if version_separator_index <= 0:
            raise RuntimeError(
                f'n8n custom package "{raw_spec}" must include an exact public npm version.'
            )
        name = raw_spec[:version_separator_index]
        version = raw_spec[version_separator_index + 1 :]
        if not re.fullmatch(
            r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
            r"(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?"
            r"(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?",
            version,
        ):
            raise RuntimeError(f'n8n custom package "{raw_spec}" must pin an exact semver version.')
        existing = by_name.get(name)
        if existing and existing["version"] != version:
            raise RuntimeError(
                "n8n custom package "
                f"{name} declares multiple versions: {existing['version']} and {version}"
            )
        by_name[name] = {"name": name, "version": version, "spec": f"{name}@{version}"}

    packages = sorted(by_name.values(), key=lambda entry: entry["name"])
    digest_payload = {
        "schemaVersion": 1,
        "packages": [{"name": entry["name"], "version": entry["version"]} for entry in packages],
    }
    digest = hashlib.sha256(canonical_json(digest_payload).encode()).hexdigest()
    return {
        "packageSpecs": [entry["spec"] for entry in packages],
        "digest": digest,
    }


def assert_optional_digest(expected, actual, label):
    if expected is None:
        return
    if not isinstance(expected, str) or not expected.strip():
        raise RuntimeError(f"{label} must be a sha256 hex digest.")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
        raise RuntimeError(f"{label} must be a sha256 hex digest.")
    if expected.lower() != actual.lower():
        raise RuntimeError(f"{label} must match normalized n8n package config digest {actual}.")


def n8n_expected_package_digest(desired_config, key, env_name):
    value = desired_config.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    env_value = os.environ.get(env_name)
    if env_value and env_value.strip():
        return env_value.strip()
    return None


def n8n_terraform_overrides(
    stage,
    account_id,
    operation,
    desired_config,
    manifest_images,
    current_outputs=None,
    n8n_guardrails=None,
    twenty_guardrails=None,
):
    current_outputs = current_outputs or {}
    n8n_guardrails = n8n_guardrails or {}
    twenty_guardrails = twenty_guardrails or {}
    provisioned = operation != "DESTROY"
    runtime_enabled = provisioned and operation != "PARK"
    if not provisioned:
        return {
            "n8n_provisioned": False,
            "n8n_runtime_enabled": False,
        }

    package_config = normalize_n8n_package_config(desired_config)
    package_specs = package_config["packageSpecs"]
    package_config_digest = n8n_expected_package_digest(
        desired_config,
        "packageConfigDigest",
        "THINKWORK_N8N_PACKAGE_CONFIG_DIGEST",
    )
    package_image_config_digest = n8n_expected_package_digest(
        desired_config,
        "packageImageConfigDigest",
        "THINKWORK_N8N_PACKAGE_IMAGE_CONFIG_DIGEST",
    )
    assert_optional_digest(
        package_config_digest,
        package_config["digest"],
        "n8n packageConfigDigest",
    )
    assert_optional_digest(
        package_image_config_digest,
        package_config["digest"],
        "n8n packageImageConfigDigest",
    )

    release_image_uri = first_non_empty_string(
        release_runtime_image("n8n-runtime"),
        release_runtime_image("n8n"),
        release_runtime_image("managed-app-n8n"),
        n8n_guardrails.get("n8n_image_uri", ""),
    )
    base_image_uri = required_config_value(
        desired_config,
        manifest_images,
        "imageUri",
        "THINKWORK_N8N_IMAGE_URI",
        "imageUri",
        ["n8n", "n8n-runtime", "managed-app-n8n"],
        default=release_image_uri,
    )
    package_image_uri = config_value(
        desired_config,
        manifest_images,
        "packageImageUri",
        "THINKWORK_N8N_PACKAGE_IMAGE_URI",
    )
    if package_image_uri and not package_specs:
        raise RuntimeError("n8n packageImageUri requires at least one custom package spec.")
    if package_specs and not package_image_uri:
        raise RuntimeError("n8n custom package specs require n8n packageImageUri.")
    resolved_image_uri = package_image_uri if package_specs else base_image_uri

    inferred_base_domain = first_non_empty_string(
        os.environ.get("THINKWORK_DOMAIN", ""),
        sibling_app_base_domain(twenty_guardrails.get("twenty_public_url", "")),
        sibling_app_base_domain(state_output(current_outputs, "twenty_url", "")),
        sibling_app_base_domain(state_output(current_outputs, "app_url", "")),
    )
    domain = config_value(
        desired_config,
        manifest_images,
        "domain",
        "THINKWORK_N8N_DOMAIN",
        default=inferred_base_domain,
    )
    public_url = config_value(
        desired_config,
        manifest_images,
        "publicUrl",
        "THINKWORK_N8N_PUBLIC_URL",
        default=n8n_guardrails.get("n8n_public_url", ""),
    ) or n8n_public_url_from_domain(domain)
    n8n_domain = url_hostname(public_url) or domain
    database_admin_secret_arn = config_value(
        desired_config,
        manifest_images,
        "databaseAdminSecretArn",
        "THINKWORK_N8N_DATABASE_ADMIN_SECRET_ARN",
        default=first_non_empty_string(
            n8n_guardrails.get("n8n_database_admin_secret_arn", ""),
            state_output(current_outputs, "db_secret_arn", ""),
        ),
    )
    if not database_admin_secret_arn:
        raise RuntimeError(
            "n8n managed app operation is missing required desired-state field: "
            "databaseAdminSecretArn."
        )
    generated_secret_guardrail_default = "" if operation == "ENABLE" else None
    database_url_secret_arn = config_value(
        desired_config,
        manifest_images,
        "databaseUrlSecretArn",
        "THINKWORK_N8N_DATABASE_URL_SECRET_ARN",
        default=(
            generated_secret_guardrail_default
            if generated_secret_guardrail_default is not None
            else n8n_guardrails.get("n8n_database_url_secret_arn", "")
        ),
    )
    encryption_key_secret_arn = config_value(
        desired_config,
        manifest_images,
        "encryptionKeySecretArn",
        "THINKWORK_N8N_ENCRYPTION_KEY_SECRET_ARN",
        default=(
            generated_secret_guardrail_default
            if generated_secret_guardrail_default is not None
            else n8n_guardrails.get("n8n_encryption_key_secret_arn", "")
        ),
    )
    operator_secret_arn = config_value(
        desired_config,
        manifest_images,
        "operatorSecretArn",
        "THINKWORK_N8N_OPERATOR_SECRET_ARN",
        default=(
            generated_secret_guardrail_default
            if generated_secret_guardrail_default is not None
            else n8n_guardrails.get("n8n_operator_secret_arn", "")
        ),
    )
    service_credential_secret_arn = config_value(
        desired_config,
        manifest_images,
        "serviceCredentialSecretArn",
        "THINKWORK_N8N_SERVICE_CREDENTIAL_SECRET_ARN",
        default=(
            generated_secret_guardrail_default
            if generated_secret_guardrail_default is not None
            else n8n_guardrails.get("n8n_service_credential_secret_arn", "")
        ),
    )
    certificate_arn = config_value(
        desired_config,
        manifest_images,
        "certificateArn",
        "THINKWORK_N8N_CERTIFICATE_ARN",
        default="",
    )
    create_secret_placeholders = any(
        not value
        for value in [
            database_url_secret_arn,
            encryption_key_secret_arn,
            operator_secret_arn,
            service_credential_secret_arn,
        ]
    )

    return {
        "n8n_provisioned": True,
        "n8n_runtime_enabled": runtime_enabled,
        "n8n_image_uri": resolved_image_uri,
        "n8n_database_admin_secret_arn": database_admin_secret_arn,
        "n8n_database_url_secret_arn": database_url_secret_arn,
        "n8n_database_name": config_value(
            desired_config,
            manifest_images,
            "databaseName",
            "THINKWORK_N8N_DATABASE_NAME",
            default=n8n_guardrails.get("n8n_database_name", "thinkwork_n8n"),
        ),
        "n8n_database_username": config_value(
            desired_config,
            manifest_images,
            "databaseUsername",
            "THINKWORK_N8N_DATABASE_USERNAME",
            default=n8n_guardrails.get("n8n_database_username", "thinkwork_n8n"),
        ),
        "n8n_encryption_key_secret_arn": encryption_key_secret_arn,
        "n8n_operator_secret_arn": operator_secret_arn,
        "n8n_service_credential_secret_arn": service_credential_secret_arn,
        "n8n_storage_bucket_name": config_value(
            desired_config,
            manifest_images,
            "storageBucketName",
            "THINKWORK_N8N_STORAGE_BUCKET_NAME",
            default=n8n_guardrails.get(
                "n8n_storage_bucket_name",
                f"thinkwork-{stage}-{account_id}-n8n",
            ),
        ),
        "n8n_create_storage_bucket": config_bool(
            desired_config,
            "createStorageBucket",
            "THINKWORK_N8N_CREATE_STORAGE_BUCKET",
            bool(n8n_guardrails.get("n8n_create_storage_bucket", True)),
        ),
        "n8n_storage_prefix": config_value(
            desired_config,
            manifest_images,
            "storagePrefix",
            "THINKWORK_N8N_STORAGE_PREFIX",
            default=n8n_guardrails.get("n8n_storage_prefix", "managed-apps/n8n"),
        ),
        "n8n_domain": n8n_domain,
        "n8n_public_url": public_url,
        "n8n_certificate_arn": certificate_arn,
        "n8n_main_desired_count": config_int(
            desired_config,
            "mainDesiredCount",
            "THINKWORK_N8N_MAIN_DESIRED_COUNT",
            n8n_guardrails.get("n8n_main_desired_count", 1),
        ),
        "n8n_worker_desired_count": config_int(
            desired_config,
            "workerDesiredCount",
            "THINKWORK_N8N_WORKER_DESIRED_COUNT",
            n8n_guardrails.get("n8n_worker_desired_count", 1),
        ),
        "n8n_worker_concurrency": config_int(
            desired_config,
            "workerConcurrency",
            "THINKWORK_N8N_WORKER_CONCURRENCY",
            n8n_guardrails.get("n8n_worker_concurrency", 10),
        ),
        "n8n_container_port": config_int(
            desired_config,
            "containerPort",
            "THINKWORK_N8N_CONTAINER_PORT",
            n8n_guardrails.get("n8n_container_port", 5678),
        ),
        "n8n_queue_mode": True,
        "n8n_task_runners_enabled": config_bool(
            desired_config,
            "taskRunnersEnabled",
            "THINKWORK_N8N_TASK_RUNNERS_ENABLED",
            bool(n8n_guardrails.get("n8n_task_runners_enabled", True)),
        ),
        "n8n_package_config_digest": package_config["digest"]
        if package_specs or package_config_digest is not None
        else n8n_guardrails.get("n8n_package_config_digest", ""),
        "n8n_custom_package_specs": package_specs
        or n8n_guardrails.get("n8n_custom_package_specs", []),
        "n8n_execution_data_storage_mode": config_value(
            desired_config,
            manifest_images,
            "executionDataStorageMode",
            "THINKWORK_N8N_EXECUTION_DATA_STORAGE_MODE",
            default=n8n_guardrails.get("n8n_execution_data_storage_mode", "database"),
        ),
        "n8n_binary_data_mode": n8n_binary_data_mode(
            config_value(
                desired_config,
                manifest_images,
                "binaryDataMode",
                "THINKWORK_N8N_BINARY_DATA_MODE",
                default=n8n_guardrails.get("n8n_binary_data_mode", "default"),
            )
        ),
        "n8n_cache_engine": config_value(
            desired_config,
            manifest_images,
            "cacheEngine",
            "THINKWORK_N8N_CACHE_ENGINE",
            default=n8n_guardrails.get("n8n_cache_engine", "valkey"),
        ),
        "n8n_cache_engine_version": config_value(
            desired_config,
            manifest_images,
            "cacheEngineVersion",
            "THINKWORK_N8N_CACHE_ENGINE_VERSION",
            default=n8n_guardrails.get("n8n_cache_engine_version", "8.0"),
        ),
        "n8n_cache_parameter_group_family": config_value(
            desired_config,
            manifest_images,
            "cacheParameterGroupFamily",
            "THINKWORK_N8N_CACHE_PARAMETER_GROUP_FAMILY",
            default=n8n_guardrails.get(
                "n8n_cache_parameter_group_family",
                "valkey8",
            ),
        ),
        "n8n_cache_node_type": config_value(
            desired_config,
            manifest_images,
            "cacheNodeType",
            "THINKWORK_N8N_CACHE_NODE_TYPE",
            default=n8n_guardrails.get("n8n_cache_node_type", "cache.t4g.micro"),
        ),
        "n8n_cache_num_cache_clusters": config_int(
            desired_config,
            "cacheNumCacheClusters",
            "THINKWORK_N8N_CACHE_NUM_CACHE_CLUSTERS",
            n8n_guardrails.get("n8n_cache_num_cache_clusters", 1),
        ),
        "n8n_allowed_public_cidr_blocks": config_string_list(
            desired_config,
            "allowedPublicCidrBlocks",
            "THINKWORK_N8N_ALLOWED_PUBLIC_CIDR_BLOCKS",
            n8n_guardrails.get("n8n_allowed_public_cidr_blocks", ["0.0.0.0/0"]),
        ),
        "n8n_kms_key_arns": config_string_list(
            desired_config,
            "kmsKeyArns",
            "THINKWORK_N8N_KMS_KEY_ARNS",
            n8n_guardrails.get("n8n_kms_key_arns", []),
        ),
        "deployment_control_plane_create_secret_placeholders": create_secret_placeholders,
    }


def twenty_terraform_overrides(
    operation,
    desired_config,
    manifest_images,
    current_outputs=None,
    twenty_guardrails=None,
    payload=None,
):
    current_outputs = current_outputs or {}
    twenty_guardrails = twenty_guardrails or {}
    payload = payload or {}
    provisioned = operation != "DESTROY"
    runtime_enabled = provisioned and operation != "PARK"
    if not provisioned:
        return {
            "twenty_provisioned": False,
            "twenty_runtime_enabled": False,
        }

    release_image_uri = first_non_empty_string(
        release_runtime_image("twenty"),
        release_runtime_image("twenty-crm"),
        release_runtime_image("managed-app-twenty"),
        twenty_guardrails.get("twenty_image_uri", ""),
    )
    image_uri = required_config_value(
        desired_config,
        manifest_images,
        "imageUri",
        "THINKWORK_TWENTY_IMAGE_URI",
        "imageUri",
        ["twenty", "twenty-crm", "managed-app-twenty"],
        default=release_image_uri,
        app_label="twenty",
    )
    inferred_domain = first_non_empty_string(
        desired_config.get("domain", ""),
        os.environ.get("THINKWORK_TWENTY_DOMAIN", ""),
        os.environ.get("THINKWORK_DOMAIN", ""),
        payload.get("customerDomain", ""),
        sibling_app_base_domain(state_output(current_outputs, "app_url", "")),
    )
    public_url = config_value(
        desired_config,
        manifest_images,
        "publicUrl",
        "THINKWORK_TWENTY_PUBLIC_URL",
        default=first_non_empty_string(
            twenty_guardrails.get("twenty_public_url", ""),
            state_output(current_outputs, "twenty_url", ""),
            twenty_public_url_from_domain(inferred_domain),
        ),
    )
    certificate_arn = required_config_value(
        desired_config,
        manifest_images,
        "certificateArn",
        "THINKWORK_TWENTY_CERTIFICATE_ARN",
        "certificateArn",
        default=first_non_empty_string(
            twenty_guardrails.get("twenty_certificate_arn", ""),
            payload.get("appCertificateArn", ""),
        ),
        app_label="twenty",
    )
    db_url_secret_arn = config_value(
        desired_config,
        manifest_images,
        "dbUrlSecretArn",
        "THINKWORK_TWENTY_DB_URL_SECRET_ARN",
        default=twenty_guardrails.get("twenty_db_url_secret_arn", ""),
    )
    encryption_key_secret_arn = config_value(
        desired_config,
        manifest_images,
        "encryptionKeySecretArn",
        "THINKWORK_TWENTY_ENCRYPTION_KEY_SECRET_ARN",
        default=twenty_guardrails.get("twenty_encryption_key_secret_arn", ""),
    )

    return {
        "twenty_provisioned": True,
        "twenty_runtime_enabled": runtime_enabled,
        "twenty_image_uri": image_uri,
        "twenty_db_username": config_value(
            desired_config,
            manifest_images,
            "dbUsername",
            "THINKWORK_TWENTY_DB_USERNAME",
            default=twenty_guardrails.get("twenty_db_username", "thinkwork_twenty"),
        ),
        "twenty_db_name": config_value(
            desired_config,
            manifest_images,
            "dbName",
            "THINKWORK_TWENTY_DB_NAME",
            default=twenty_guardrails.get("twenty_db_name", "thinkwork_twenty"),
        ),
        "twenty_db_url_secret_arn": db_url_secret_arn,
        "twenty_encryption_key_secret_arn": encryption_key_secret_arn,
        "twenty_email_from_address": config_value(
            desired_config,
            manifest_images,
            "emailFromAddress",
            "THINKWORK_TWENTY_EMAIL_FROM_ADDRESS",
            default=twenty_guardrails.get("twenty_email_from_address", ""),
        ),
        "twenty_email_from_name": config_value(
            desired_config,
            manifest_images,
            "emailFromName",
            "THINKWORK_TWENTY_EMAIL_FROM_NAME",
            default=twenty_guardrails.get("twenty_email_from_name", "ThinkWork CRM"),
        ),
        "twenty_public_url": public_url,
        "twenty_certificate_arn": certificate_arn,
        "deployment_control_plane_create_secret_placeholders": (
            not db_url_secret_arn or not encryption_key_secret_arn
        ),
    }


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
    twenty_guardrails = state_terraform_data_input(
        current_state,
        "twenty_configuration_guardrails",
    )
    n8n_guardrails = state_terraform_data_input(
        current_state,
        "n8n_configuration_guardrails",
    )

    overrides = {
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
        "n8n_provisioned": bool(state_output(current_outputs, "n8n_provisioned", False)),
        "n8n_runtime_enabled": bool(state_output(current_outputs, "n8n_runtime_enabled", False)),
        "n8n_image_uri": n8n_guardrails.get("n8n_image_uri", ""),
        "n8n_database_admin_secret_arn": n8n_guardrails.get(
            "n8n_database_admin_secret_arn",
            "",
        ),
        "n8n_database_url_secret_arn": n8n_guardrails.get(
            "n8n_database_url_secret_arn",
            "",
        ),
        "n8n_database_name": n8n_guardrails.get("n8n_database_name", "thinkwork_n8n"),
        "n8n_database_username": n8n_guardrails.get(
            "n8n_database_username",
            "thinkwork_n8n",
        ),
        "n8n_encryption_key_secret_arn": n8n_guardrails.get(
            "n8n_encryption_key_secret_arn",
            "",
        ),
        "n8n_operator_secret_arn": n8n_guardrails.get("n8n_operator_secret_arn", ""),
        "n8n_service_credential_secret_arn": n8n_guardrails.get(
            "n8n_service_credential_secret_arn",
            "",
        ),
        "n8n_storage_bucket_name": n8n_guardrails.get("n8n_storage_bucket_name", ""),
        "n8n_create_storage_bucket": n8n_guardrails.get("n8n_create_storage_bucket", True),
        "n8n_storage_prefix": n8n_guardrails.get("n8n_storage_prefix", "managed-apps/n8n"),
        "n8n_domain": "",
        "n8n_public_url": n8n_guardrails.get(
            "n8n_public_url",
            state_output(current_outputs, "n8n_url", ""),
        ),
        "n8n_certificate_arn": n8n_guardrails.get("n8n_certificate_arn", ""),
        "n8n_main_desired_count": n8n_guardrails.get("n8n_main_desired_count", 1),
        "n8n_worker_desired_count": n8n_guardrails.get("n8n_worker_desired_count", 1),
        "n8n_worker_concurrency": n8n_guardrails.get("n8n_worker_concurrency", 10),
        "n8n_container_port": n8n_guardrails.get("n8n_container_port", 5678),
        "n8n_queue_mode": n8n_guardrails.get("n8n_queue_mode", True),
        "n8n_task_runners_enabled": n8n_guardrails.get("n8n_task_runners_enabled", True),
        "n8n_package_config_digest": n8n_guardrails.get("n8n_package_config_digest", ""),
        "n8n_custom_package_specs": n8n_guardrails.get("n8n_custom_package_specs", []),
        "n8n_execution_data_storage_mode": n8n_guardrails.get(
            "n8n_execution_data_storage_mode",
            "database",
        ),
        "n8n_binary_data_mode": n8n_binary_data_mode(
            n8n_guardrails.get("n8n_binary_data_mode", "default")
        ),
        "n8n_cache_engine": n8n_guardrails.get("n8n_cache_engine", "valkey"),
        "n8n_cache_engine_version": n8n_guardrails.get("n8n_cache_engine_version", "8.0"),
        "n8n_cache_parameter_group_family": n8n_guardrails.get(
            "n8n_cache_parameter_group_family",
            "valkey8",
        ),
        "n8n_cache_node_type": n8n_guardrails.get(
            "n8n_cache_node_type",
            "cache.t4g.micro",
        ),
        "n8n_cache_num_cache_clusters": n8n_guardrails.get(
            "n8n_cache_num_cache_clusters",
            1,
        ),
        "n8n_allowed_public_cidr_blocks": n8n_guardrails.get(
            "n8n_allowed_public_cidr_blocks",
            ["0.0.0.0/0"],
        ),
        "n8n_kms_key_arns": n8n_guardrails.get("n8n_kms_key_arns", []),
        "n8n_dns_enabled": False,
        "n8n_dns_name": "",
    }

    # Foundation updates must not tear down n8n's managed certificate/DNS:
    # the guardrail records the managed cert's own ARN, which (combined with
    # a blank n8n_domain) flips n8n_managed_certificate_enabled off and
    # plans a destroy of a cert still attached to the n8n ALB (observed:
    # McPherson update to v0.1.0-canary.314). When state shows the root
    # managed cert, reproduce the install-time inputs instead.
    managed_n8n_cert = state_root_resource_attributes(current_state, "aws_acm_certificate", "n8n")
    if managed_n8n_cert:
        overrides["n8n_domain"] = (
            managed_n8n_cert.get("domain_name") or url_hostname(overrides["n8n_public_url"]) or ""
        )
        overrides["n8n_certificate_arn"] = ""
    foundation_n8n_dns_name = overrides["n8n_domain"] or url_hostname(overrides["n8n_public_url"])
    if overrides["n8n_provisioned"] and foundation_n8n_dns_name:
        # State-derived zone lookup goes blank once the cloudflare_record
        # resources are absent (e.g. a prior partial destroy) — fall back
        # to the Cloudflare API resolver the n8n install path uses.
        overrides["cloudflare_zone_id"] = overrides[
            "cloudflare_zone_id"
        ] or cloudflare_zone_id_for_hostname(stage, foundation_n8n_dns_name)
        overrides["n8n_dns_name"] = foundation_n8n_dns_name
        overrides["n8n_dns_enabled"] = bool(overrides["cloudflare_zone_id"])

    if app_key == "n8n":
        provisioned = operation != "DESTROY"
        overrides.update(
            n8n_terraform_overrides(
                stage,
                account_id,
                operation,
                desired_config,
                manifest_images,
                current_outputs,
                n8n_guardrails,
                twenty_guardrails,
            )
        )
        n8n_dns_name = overrides["n8n_domain"] or url_hostname(overrides["n8n_public_url"])
        overrides["cloudflare_zone_id"] = overrides[
            "cloudflare_zone_id"
        ] or cloudflare_zone_id_for_hostname(stage, n8n_dns_name)
        overrides["n8n_dns_name"] = n8n_dns_name
        overrides["n8n_dns_enabled"] = (
            provisioned and bool(overrides["cloudflare_zone_id"]) and bool(n8n_dns_name)
        )
        return overrides

    if app_key == "twenty":
        overrides.update(
            twenty_terraform_overrides(
                operation,
                desired_config,
                manifest_images,
                current_outputs,
                twenty_guardrails,
                payload,
            )
        )
        return overrides

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


def resolve_agentcore_pi_source_image_uri(payload):
    operation = payload.get("operation") if isinstance(payload.get("operation"), dict) else {}
    action = str(
        safe_get(operation, "action", default=safe_get(payload, "action", "phase", default=""))
    ).lower()
    kind = str(safe_get(operation, "kind", default="")).lower()
    is_customer_update = (
        action == "update" or kind == "foundation"
    ) and kind != "identity_provider"
    explicit = safe_get(payload, "agentcorePiSourceImageUri", default="")
    if explicit:
        if is_customer_update:
            account_id = safe_get(payload, "awsAccountId", default="")
            region = safe_get(payload, "awsRegion", default=os.environ.get("AWS_REGION", ""))
            customer_registry = f"{account_id}.dkr.ecr.{region}.amazonaws.com/"
            if not account_id or not region or not explicit.startswith(customer_registry):
                raise RuntimeError(
                    "Customer foundation updates require agentcorePiSourceImageUri "
                    "to reference the customer-owned ECR registry."
                )
        return explicit

    if is_customer_update:
        raise RuntimeError(
            "Customer foundation updates require an explicit customer-ECR "
            "agentcorePiSourceImageUri; refusing to fall back to the release registry."
        )

    return release_runtime_image("agentcore-pi-amd64")


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
    if not manifest_url and not MANIFEST.exists():
        return
    if not MANIFEST.exists():
        download(manifest_url, MANIFEST)
    verify_release_manifest_digest(MANIFEST, manifest_sha256)


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


def is_pinned_thinkwork_module_source(module_source):
    source = module_source.removeprefix("git::")
    source_path, _, _query = source.partition("?")
    return source_path in {
        "https://github.com/thinkwork-ai/thinkwork.git//terraform/modules/thinkwork",
        "https://github.com/thinkwork-ai/thinkwork//terraform/modules/thinkwork",
        "github.com/thinkwork-ai/thinkwork.git//terraform/modules/thinkwork",
        "github.com/thinkwork-ai/thinkwork//terraform/modules/thinkwork",
    }


def selected_module_source_inputs(payload, release_version):
    payload_module_source = safe_get(payload, "terraformModuleSource", default="")
    if payload_module_source:
        return (
            payload_module_source,
            safe_get(payload, "terraformModuleVersion", default=""),
        )

    module_source = os.environ["THINKWORK_TERRAFORM_MODULE_SOURCE"]
    module_version = os.environ.get("THINKWORK_TERRAFORM_MODULE_VERSION", "")
    if is_pinned_thinkwork_module_source(module_source):
        # Existing controllers may have persisted a concrete git ref for the
        # module source. Managed-app payloads still generate the wrapper from
        # the selected release, so the child module must follow that release
        # too or new app arguments fail Terraform config loading immediately.
        return "thinkwork-ai/thinkwork/aws", release_version.removeprefix("v")
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


def migration_files(vars_json=None):
    migrations = SOURCE / "packages/database-pg/drizzle"
    allow_auth_retirement = bool(
        isinstance(vars_json, dict)
        and vars_json.get("auth_retirement_phase") == "retired"
        and vars_json.get("finalize_auth_retirement") is True
    )
    paths = []
    for path in migrations.glob("*.sql"):
        if "rollback" in path.name:
            continue
        if (
            AUTH_RETIREMENT_MIGRATION_MARKER in path.read_text(encoding="utf-8")
            and not allow_auth_retirement
        ):
            continue
        paths.append(path)
    return sorted(paths)


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
    for path in migration_files(vars_json):
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


def backfill_platform_migration_ledger(database_url, vars_json):
    """One-time ledger bootstrap for environments installed before the ledger
    existed. Every file shipping with this release is recorded as assumed
    applied — auto-re-running old files is unsafe (markers can name objects
    that later migrations intentionally dropped). Marker-verified drift is
    reported so an operator can true it up manually; releases after the
    transition apply through the exact pending path."""
    verified = []
    assumed = []
    for path in migration_files(vars_json):
        match = re.match(r"^(\d{4})_", path.name)
        migration_number = int(match.group(1)) if match else None
        verdicts = [
            platform_migration_object_present(database_url, kind, name)
            for kind, name in declared_migration_objects(path)
        ]
        # The ledger ships with the native-auth release. Files through 0260 may
        # already have been applied by the old deploy paths and cannot safely be
        # replayed. Files introduced with this release must never be silently
        # assumed: record them only when every declared object is present;
        # otherwise leave them pending so apply_pending_platform_migrations runs
        # them before the app is published.
        if (
            migration_number is not None
            and migration_number > PLATFORM_MIGRATION_LEDGER_CUTOFF
            and (not verdicts or any(verdict is not True for verdict in verdicts))
        ):
            print(
                f"[migrations] transition: {path.name} is newer than the pre-ledger cutoff "
                "and remains pending"
            )
            continue
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
    for path in migration_files(vars_json):
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
    explicit = (
        safe_get(
            runner_secrets,
            "tenantSlug",
            default=safe_get(payload, "tenantSlug", default=""),
        )
        .strip()
        .lower()
    )
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
        folder = (
            "".join(
                ch if (ch.isascii() and (ch.islower() or ch.isdigit())) else "-"
                for ch in local_part.lower()
            ).strip("-")
            or "user"
        )
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


def ensure_hindsight_database(database_url, vars_json):
    """THINK-220: the dedicated Hindsight database is bootstrap SQL — Terraform
    cannot CREATE DATABASE inside the cluster. Runs post-apply; the Hindsight
    service may crash-loop briefly on a first enablement until this creates
    the database, then ECS stabilizes on its own. Vanilla boot migrations
    (RUN_MIGRATIONS_ON_STARTUP) build the schema, including the maintenance
    discovery functions the repair migration installs on base-schema runs."""
    db_name = (vars_json.get("hindsight_database_name") or "").strip()
    if not db_name:
        return
    if not re.fullmatch(r"[a-z][a-z0-9_]*", db_name):
        raise RuntimeError(f"invalid hindsight_database_name: {db_name!r}")
    admin_url = re.sub(r"/[^/?]+(\?|$)", r"/postgres\1", database_url, count=1)
    exists = psql_output(
        admin_url,
        f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'",
    ).strip()
    if not exists:
        print(f"[hindsight] creating database {db_name}")
        psql(admin_url, sql=f'CREATE DATABASE "{db_name}"')
    hindsight_url = re.sub(r"/[^/?]+(\?|$)", f"/{db_name}\\1", database_url, count=1)
    psql(hindsight_url, sql="CREATE EXTENSION IF NOT EXISTS vector;")
    print(f"[hindsight] database {db_name} ready (pgvector ensured)")


def push_database_schema(outputs_path, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    checkout_source(
        vars_json.get("deployment_terraform_module_source")
        or os.environ["THINKWORK_TERRAFORM_MODULE_SOURCE"],
        os.environ.get("THINKWORK_RELEASE_VERSION", "main"),
    )
    database_url = database_url_from_outputs(outputs)
    ensure_hindsight_database(database_url, vars_json)
    fresh = not psql_output(database_url, "SELECT to_regclass('public.tenants')").strip()
    ledger_present = bool(
        psql_output(database_url, "SELECT to_regclass('public.platform_schema_migrations')").strip()
    )
    if fresh:
        initialize_greenfield_database(database_url, outputs, vars_json)
    ensure_migration_ledger(database_url)
    if fresh:
        record_platform_migrations(
            database_url, [path.name for path in migration_files(vars_json)], "greenfield"
        )
    elif not ledger_present:
        backfill_platform_migration_ledger(database_url, vars_json)
    apply_pending_platform_migrations(database_url, outputs, vars_json)
    seed_platform_bootstrap_defaults(database_url)
    migrations = SOURCE / "packages/database-pg/drizzle"
    for name in POST_SEED_MIGRATIONS:
        path = migrations / name
        if not path.is_file():
            raise RuntimeError(f"Required platform migration is missing: {path}")
        apply_migration_file(database_url, outputs, vars_json, path)


def prepare_additive_schema_before_app(payload, vars_json):
    """Materialize foundation/data dependencies and apply additive schema before
    the full app plan can publish Lambdas that consume it. Retirement stays
    disabled here and, when explicitly requested, runs only after the app
    retirement phase has deployed."""
    action = str(payload.get("action") or "").lower()
    if (
        action not in {"deploy", "update"}
        or is_managed_app_operation(payload)
        or identity_provider_operation(payload) is not None
    ):
        return None
    target = "module.thinkwork.module.database"
    plan = subprocess.run(
        [
            "terraform",
            "plan",
            f"-target={target}",
            "-out=tfplan-data",
            "-no-color",
        ],
        cwd=TF,
        text=True,
    )
    if plan.returncode != 0:
        return plan
    applied = subprocess.run(
        ["terraform", "apply", "-auto-approve", "-no-color", "tfplan-data"],
        cwd=TF,
        text=True,
    )
    if applied.returncode != 0:
        return applied
    outputs_path = TF / "pre-app-outputs.json"
    outputs_path.write_text(
        output(["terraform", "output", "-json"], cwd=TF),
        encoding="utf-8",
    )
    additive_vars = dict(vars_json)
    additive_vars["finalize_auth_retirement"] = False
    push_database_schema(outputs_path, additive_vars)
    TERRAFORM_EVIDENCE["schemaOrdering"] = {
        "status": "succeeded",
        "target": target,
        "phase": "foundation-data-additive-before-app",
    }
    return applied


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
    module_source, module_version = selected_module_source_inputs(
        payload,
        release_version,
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

    auth_state = auth_reconciliation_state(stage)
    tenant_auth_metadata = identity_provider_desired_connections(
        payload,
        stage=stage,
        account_id=account_id,
        region=region,
        previous_state=auth_state,
        current_outputs=current_outputs,
    )
    prior_phase_output = current_outputs.get("auth_retirement_phase")
    prior_phase = prior_phase_output.get("value") if isinstance(prior_phase_output, dict) else None
    if prior_phase not in {"coexistence", "cutover", "retired"}:
        # An existing pre-native-auth stack must enter through coexistence.
        # A truly empty state is greenfield and has no WorkOS runtime to keep.
        prior_phase = "coexistence" if current_state else "retired"
    auth_retirement_phase = safe_get(
        runner_secrets,
        "authRetirementPhase",
        default=safe_get(
            reviewed_payload,
            "authRetirementPhase",
            default=prior_phase,
        ),
    )
    if auth_retirement_phase not in {"coexistence", "cutover", "retired"}:
        raise RuntimeError("authRetirementPhase must be coexistence, cutover, or retired")
    auth_migration_recovery_deadline = safe_get(
        runner_secrets,
        "authMigrationRecoveryDeadline",
        default=safe_get(
            reviewed_payload,
            "authMigrationRecoveryDeadline",
            default=os.environ.get("AUTH_MIGRATION_RECOVERY_DEADLINE", ""),
        ),
    ).strip()
    if auth_migration_recovery_deadline:
        try:
            parsed_recovery_deadline = datetime.fromisoformat(
                auth_migration_recovery_deadline.replace("Z", "+00:00")
            )
            if parsed_recovery_deadline.tzinfo is None:
                raise ValueError("timezone required")
        except ValueError as exc:
            raise RuntimeError(
                "authMigrationRecoveryDeadline must be an RFC3339 timestamp"
            ) from exc
    if auth_retirement_phase == "coexistence" and not auth_migration_recovery_deadline:
        raise RuntimeError(
            "authMigrationRecoveryDeadline is required while authRetirementPhase is coexistence"
        )
    finalize_auth_retirement = payload.get("finalizeAuthRetirement") is True
    vars_json = {
        "stage": stage,
        "region": region,
        "account_id": account_id,
        "db_password": db_password,
        "api_auth_secret": api_auth_secret,
        "auth_retirement_phase": auth_retirement_phase,
        "auth_migration_recovery_deadline": auth_migration_recovery_deadline,
        "finalize_auth_retirement": finalize_auth_retirement,
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
        # Analyst data-path Lambda VPC egress (stable NAT EIP for external
        # database IP allowlists). Per-environment infra posture, so the
        # durable home is the runner-secrets document; a payload boolean
        # can override per-deploy.
        "analyst_lambda_vpc_egress": safe_get_bool(
            runner_secrets,
            reviewed_payload,
            "analystLambdaVpcEgress",
            default=False,
        ),
        # THINK-220: dedicated Hindsight database on the stage cluster.
        # Empty keeps the legacy hindsight-schema layout; set (e.g.
        # "thinkwork_hindsight") points the Hindsight service and platform
        # readers at that database's public schema, where upstream's
        # maintenance discovery actually runs.
        "hindsight_database_name": safe_get(
            reviewed_payload,
            "hindsightDatabaseName",
            default="",
        ),
        # AgentCore Harness is an environment-level deployment choice. The
        # controller carries these reviewed, non-secret values forward so a
        # release update cannot silently remove the managed runtime plane.
        # The registry module retains its rollout-era multiplayer-proof input
        # names for compatibility; all provisioning still happens in the
        # normal Terraform apply owned by this controller.
        "enable_agentcore_multiplayer_proof": safe_get_bool(
            {},
            reviewed_payload,
            "enableAgentCoreHarness",
            default=False,
        ),
        "agentcore_multiplayer_proof_tenant_slug": safe_get(
            reviewed_payload,
            "agentCoreHarnessTenantSlug",
            default="",
        ),
        "agentcore_multiplayer_proof_owner_allowlist": safe_get(
            reviewed_payload,
            "agentCoreHarnessOwnerAllowlist",
            default="",
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
                default="",
            ),
        ),
        # Secret-free desired metadata. The compact Terraform projection only
        # creates provider-specific public app clients; the runner reconciles
        # the secret-bearing Cognito IdP before Terraform plans those clients.
        "tenant_entra_connections": tenant_entra_terraform_projection(tenant_auth_metadata),
        "auth_tenant_connection_metadata": tenant_auth_metadata,
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
        "deployment_terraform_module_source": terraform_module_source,
        "deployment_terraform_module_version": terraform_module_version,
        "agentcore_pi_source_image_uri": resolve_agentcore_pi_source_image_uri(payload),
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
    incident_import_blocks = tei_v380_recovery_import_blocks(payload, vars_json)

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
  # The managed deployment runtime is pinned to this floor. Terraform 1.8.5
  # adds declarative state-only removal, used below to forget the original
  # non-owning AgentCore reconciliation marker without a destroy action.
  required_version = ">= 1.8.5"

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

# The original AgentCore Twenty reconciliation marker never owned external
# cleanup, but an interrupted local-exec may have left it tainted. Forget every
# counted instance from managed-deployment state without refresh, provider RPC,
# or destroy provisioners. The child module owns the replacement idempotent
# reconciliation marker under a new address.
removed {{
  from = module.thinkwork.module.agentcore_proof_identity.terraform_data.twenty_identity_lifecycle

  lifecycle {{
    destroy = false
  }}
}}

{incident_import_blocks}

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

variable "auth_retirement_phase" {{
  type    = string
  default = "coexistence"
}}

variable "auth_migration_recovery_deadline" {{
  type    = string
  default = ""
}}

variable "database_engine" {{
  type = string
}}

variable "enable_hindsight" {{
  type = bool
}}

variable "analyst_lambda_vpc_egress" {{
  type    = bool
  default = false
}}

variable "hindsight_database_name" {{
  type    = string
  default = ""
}}

variable "enable_agentcore_multiplayer_proof" {{
  type    = bool
  default = false
}}

variable "agentcore_multiplayer_proof_tenant_slug" {{
  type    = string
  default = ""
}}

variable "agentcore_multiplayer_proof_owner_allowlist" {{
  type    = string
  default = ""
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
  type    = string
  default = ""
}}

variable "tenant_entra_connections" {{
  type = list(object({{
    connection_key = string
    tenant_id      = string
    provider_name  = string
    display_name   = string
  }}))
  default = []
}}

variable "auth_tenant_connection_metadata" {{
  type    = list(any)
  default = []
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

variable "n8n_provisioned" {{
  type = bool
}}

variable "n8n_runtime_enabled" {{
  type = bool
}}

variable "n8n_image_uri" {{
  type = string
}}

variable "n8n_database_admin_secret_arn" {{
  type = string
}}

variable "n8n_database_url_secret_arn" {{
  type = string
}}

variable "n8n_database_username" {{
  type = string
}}

variable "n8n_database_name" {{
  type = string
}}

variable "n8n_encryption_key_secret_arn" {{
  type = string
}}

variable "n8n_operator_secret_arn" {{
  type = string
}}

variable "n8n_service_credential_secret_arn" {{
  type = string
}}

variable "n8n_storage_bucket_name" {{
  type = string
}}

variable "n8n_create_storage_bucket" {{
  type = bool
}}

variable "n8n_storage_prefix" {{
  type = string
}}

variable "n8n_domain" {{
  type = string
}}

variable "n8n_public_url" {{
  type = string
}}

variable "n8n_certificate_arn" {{
  type = string
}}

variable "n8n_main_desired_count" {{
  type = number
}}

variable "n8n_worker_desired_count" {{
  type = number
}}

variable "n8n_worker_concurrency" {{
  type = number
}}

variable "n8n_container_port" {{
  type = number
}}

variable "n8n_queue_mode" {{
  type = bool
}}

variable "n8n_task_runners_enabled" {{
  type = bool
}}

variable "n8n_package_config_digest" {{
  type = string
}}

variable "n8n_custom_package_specs" {{
  type = list(string)
}}

variable "n8n_execution_data_storage_mode" {{
  type = string
}}

variable "n8n_binary_data_mode" {{
  type = string
}}

variable "n8n_cache_engine" {{
  type = string
}}

variable "n8n_cache_engine_version" {{
  type = string
}}

variable "n8n_cache_parameter_group_family" {{
  type = string
}}

variable "n8n_cache_node_type" {{
  type = string
}}

variable "n8n_cache_num_cache_clusters" {{
  type = number
}}

variable "n8n_allowed_public_cidr_blocks" {{
  type = list(string)
}}

variable "n8n_kms_key_arns" {{
  type = list(string)
}}

variable "cloudflare_zone_id" {{
  type = string
}}

variable "n8n_dns_enabled" {{
  type = bool
}}

variable "n8n_dns_name" {{
  type = string
}}

locals {{
  n8n_managed_certificate_enabled = (
    var.n8n_provisioned &&
    var.n8n_certificate_arn == "" &&
    var.n8n_domain != "" &&
    var.cloudflare_zone_id != ""
  )
  n8n_effective_certificate_arn = (
    var.n8n_certificate_arn != ""
    ? var.n8n_certificate_arn
    : (
      local.n8n_managed_certificate_enabled
      ? aws_acm_certificate_validation.n8n[0].certificate_arn
      : ""
    )
  )
}}

resource "aws_acm_certificate" "n8n" {{
  count = local.n8n_managed_certificate_enabled ? 1 : 0

  domain_name       = var.n8n_domain
  validation_method = "DNS"

  lifecycle {{
    create_before_destroy = true
  }}

  tags = {{
    Name = "thinkwork-${{var.stage}}-n8n"
  }}
}}

resource "cloudflare_record" "n8n_acm_validation" {{
  for_each = local.n8n_managed_certificate_enabled ? {{
    for cert in aws_acm_certificate.n8n :
    cert.domain_name => tolist(cert.domain_validation_options)[0]
  }} : {{}}

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.resource_record_name, ".")
  content = trimsuffix(each.value.resource_record_value, ".")
  type    = each.value.resource_record_type
  ttl     = 60
  proxied = false
  comment = "ACM DNS validation for ${{each.key}}"

  allow_overwrite = true
}}

resource "aws_acm_certificate_validation" "n8n" {{
  count = local.n8n_managed_certificate_enabled ? 1 : 0

  certificate_arn = aws_acm_certificate.n8n[0].arn
  validation_record_fqdns = [
    for record in cloudflare_record.n8n_acm_validation : record.hostname
  ]
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
  auth_retirement_phase = var.auth_retirement_phase
  auth_migration_recovery_deadline = var.auth_migration_recovery_deadline
  database_engine = var.database_engine

  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  microsoft_oauth_client_id     = var.microsoft_oauth_client_id
  microsoft_oauth_client_secret = var.microsoft_oauth_client_secret
  microsoft_oauth_tenant        = var.microsoft_oauth_tenant
  tenant_entra_connections      = var.tenant_entra_connections
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
  analyst_lambda_vpc_egress      = var.analyst_lambda_vpc_egress
  hindsight_database_name        = var.hindsight_database_name
  enable_workspace_orchestration = true
  enable_agentcore_multiplayer_proof          = var.enable_agentcore_multiplayer_proof
  agentcore_multiplayer_proof_tenant_slug     = var.agentcore_multiplayer_proof_tenant_slug
  agentcore_multiplayer_proof_owner_allowlist = var.agentcore_multiplayer_proof_owner_allowlist

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
  n8n_provisioned                  = var.n8n_provisioned
  n8n_runtime_enabled              = var.n8n_runtime_enabled
  n8n_image_uri                    = var.n8n_image_uri
  n8n_database_admin_secret_arn    = var.n8n_database_admin_secret_arn
  n8n_database_url_secret_arn      = var.n8n_database_url_secret_arn
  n8n_database_username            = var.n8n_database_username
  n8n_database_name                = var.n8n_database_name
  n8n_encryption_key_secret_arn    = var.n8n_encryption_key_secret_arn
  n8n_operator_secret_arn          = var.n8n_operator_secret_arn
  n8n_service_credential_secret_arn = var.n8n_service_credential_secret_arn
  n8n_storage_bucket_name          = var.n8n_storage_bucket_name
  n8n_create_storage_bucket        = var.n8n_create_storage_bucket
  n8n_storage_prefix               = var.n8n_storage_prefix
  n8n_domain                       = var.n8n_domain
  n8n_public_url                   = var.n8n_public_url
  n8n_certificate_arn              = local.n8n_effective_certificate_arn
  n8n_main_desired_count           = var.n8n_main_desired_count
  n8n_worker_desired_count         = var.n8n_worker_desired_count
  n8n_worker_concurrency           = var.n8n_worker_concurrency
  n8n_container_port               = var.n8n_container_port
  n8n_queue_mode                   = var.n8n_queue_mode
  n8n_task_runners_enabled         = var.n8n_task_runners_enabled
  n8n_package_config_digest        = var.n8n_package_config_digest
  n8n_custom_package_specs         = var.n8n_custom_package_specs
  n8n_execution_data_storage_mode  = var.n8n_execution_data_storage_mode
  n8n_binary_data_mode             = var.n8n_binary_data_mode
  n8n_cache_engine                 = var.n8n_cache_engine
  n8n_cache_engine_version         = var.n8n_cache_engine_version
  n8n_cache_parameter_group_family = var.n8n_cache_parameter_group_family
  n8n_cache_node_type              = var.n8n_cache_node_type
  n8n_cache_num_cache_clusters     = var.n8n_cache_num_cache_clusters
  n8n_allowed_public_cidr_blocks   = var.n8n_allowed_public_cidr_blocks
  n8n_kms_key_arns                 = var.n8n_kms_key_arns
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

resource "cloudflare_record" "n8n" {{
  count = var.n8n_dns_enabled ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.n8n_dns_name
  content = module.thinkwork.n8n_alb_dns_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${{var.stage}} n8n -> n8n public ALB"
}}

output "app_url" {{ value = module.thinkwork.app_url }}
output "app_bucket_name" {{ value = module.thinkwork.app_bucket_name }}
output "app_distribution_id" {{ value = module.thinkwork.app_distribution_id }}
output "api_endpoint" {{ value = module.thinkwork.api_endpoint }}
output "appsync_api_url" {{ value = module.thinkwork.appsync_api_url }}
output "appsync_realtime_url" {{ value = module.thinkwork.appsync_realtime_url }}
output "auth_domain" {{ value = module.thinkwork.auth_domain }}
output "customer_domain" {{ value = module.thinkwork.customer_domain }}
output "customer_domain_name_servers" {{ value = module.thinkwork.customer_domain_name_servers }}
output "db_cluster_endpoint" {{ value = module.thinkwork.db_cluster_endpoint }}
output "db_secret_arn" {{ value = module.thinkwork.db_secret_arn }}
output "database_name" {{ value = module.thinkwork.database_name }}
output "user_pool_id" {{ value = module.thinkwork.user_pool_id }}
output "admin_client_id" {{ value = module.thinkwork.admin_client_id }}
output "web_local_client_id" {{ value = module.thinkwork.web_local_client_id }}
output "auth_route_clients" {{ value = module.thinkwork.auth_route_clients }}
output "auth_retirement_phase" {{ value = module.thinkwork.auth_retirement_phase }}
  output "docs_bucket_name" {{ value = module.thinkwork.docs_bucket_name }}
  output "docs_distribution_id" {{ value = module.thinkwork.docs_distribution_id }}
  output "docs_distribution_domain" {{ value = module.thinkwork.docs_distribution_domain }}
output "twenty_provisioned" {{ value = module.thinkwork.twenty_provisioned }}
output "twenty_runtime_enabled" {{ value = module.thinkwork.twenty_runtime_enabled }}
output "twenty_url" {{ value = module.thinkwork.twenty_url }}
output "n8n_provisioned" {{ value = module.thinkwork.n8n_provisioned }}
output "n8n_runtime_enabled" {{ value = module.thinkwork.n8n_runtime_enabled }}
output "n8n_url" {{ value = module.thinkwork.n8n_url }}
output "n8n_alb_dns_name" {{ value = module.thinkwork.n8n_alb_dns_name }}
output "n8n_alb_arn" {{ value = module.thinkwork.n8n_alb_arn }}
output "n8n_target_group_arn" {{ value = module.thinkwork.n8n_target_group_arn }}
output "n8n_cluster_arn" {{ value = module.thinkwork.n8n_cluster_arn }}
output "n8n_main_service_name" {{ value = module.thinkwork.n8n_main_service_name }}
output "n8n_worker_service_name" {{ value = module.thinkwork.n8n_worker_service_name }}
output "n8n_main_log_group_name" {{ value = module.thinkwork.n8n_main_log_group_name }}
output "n8n_worker_log_group_name" {{ value = module.thinkwork.n8n_worker_log_group_name }}
output "n8n_database_name" {{ value = module.thinkwork.n8n_database_name }}
output "n8n_database_secret_arn" {{ value = module.thinkwork.n8n_database_secret_arn }}
output "n8n_valkey_endpoint" {{ value = module.thinkwork.n8n_valkey_endpoint }}
output "n8n_storage_bucket_name" {{ value = module.thinkwork.n8n_storage_bucket_name }}
output "n8n_storage_prefix" {{ value = module.thinkwork.n8n_storage_prefix }}
output "n8n_image_digest" {{ value = module.thinkwork.n8n_image_digest }}
output "n8n_package_config_digest" {{ value = module.thinkwork.n8n_package_config_digest }}
output "n8n_service_credential_secret_arn" {{ value = module.thinkwork.n8n_service_credential_secret_arn }}
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
""",
        encoding="utf-8",
    )
    return vars_json


def sync_release_artifacts(artifact_types=None, artifact_names=None):
    global RELEASE_EVIDENCE
    artifact_types = {"lambda", "static-site"} if artifact_types is None else set(artifact_types)
    artifact_names = set(artifact_names or [])
    manifest_url = os.environ.get("THINKWORK_RELEASE_MANIFEST_URL")
    expected = os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256", "").lower()
    if not manifest_url:
        raise RuntimeError("THINKWORK_RELEASE_MANIFEST_URL is required")
    download(manifest_url, MANIFEST)
    manifest_byte_digest = sha256_file(MANIFEST)
    manifest = verify_release_manifest_digest(MANIFEST, expected)
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
        "manifestSha256": manifest_byte_digest,
        "manifestCanonicalSha256": canonical_digest,
        "trust": trust_evidence,
        "bundles": bundle_evidence,
        "artifacts": artifact_evidence,
    }
    return static_files


def managed_app_operation(payload):
    return str(payload.get("operation") or "").strip().upper()


def is_twenty_thinkwork_app_sync_operation(payload):
    app_key = str(payload.get("appKey") or "").strip().lower()
    return app_key == "twenty" and managed_app_operation(payload) in {"ENABLE", "UPGRADE"}


def stage_managed_app_release_artifacts(action, payload):
    if action not in {"deploy", "update"}:
        return {}
    if not is_twenty_thinkwork_app_sync_operation(payload):
        return {}
    return sync_release_artifacts(
        artifact_types={"seed"},
        artifact_names={"twenty-thinkwork-app"},
    )


def twenty_app_sync_api_key(runner_secrets, payload):
    return first_non_empty_string(
        runner_secrets.get("twentyAppSyncApiKey", ""),
        runner_secrets.get("twentyDeployApiKey", ""),
        payload.get("twentyAppSyncApiKey", ""),
        payload.get("twentyDeployApiKey", ""),
        os.environ.get("TWENTY_APP_SYNC_API_KEY", ""),
        os.environ.get("TWENTY_DEPLOY_API_KEY", ""),
    )


def sync_twenty_thinkwork_app(outputs_path, vars_json, payload, runner_secrets, artifacts):
    global MANAGED_APP_EVIDENCE
    if not is_twenty_thinkwork_app_sync_operation(payload):
        return

    outputs = {}
    if outputs_path.is_file():
        outputs = json.loads(outputs_path.read_text(encoding="utf-8"))

    runtime_enabled = bool_state_output(outputs, "twenty_runtime_enabled") or bool(
        vars_json.get("twenty_runtime_enabled", False)
    )
    if not runtime_enabled:
        MANAGED_APP_EVIDENCE["twentyThinkWorkApp"] = {
            "status": "skipped",
            "reason": "twenty-runtime-disabled",
        }
        return

    public_url = first_non_empty_string(
        string_state_output(outputs, "twenty_url"),
        vars_json.get("twenty_public_url", ""),
        payload.get("desiredConfig", {}).get("publicUrl", "")
        if isinstance(payload.get("desiredConfig"), dict)
        else "",
    )
    if not public_url:
        raise RuntimeError(
            "Twenty ThinkWork native app sync requires twenty_url from Terraform outputs "
            "or twenty_public_url from runner variables."
        )

    api_key = twenty_app_sync_api_key(runner_secrets, payload)
    if not api_key:
        raise RuntimeError(
            "Twenty managed app ENABLE/UPGRADE requires twentyAppSyncApiKey or "
            "twentyDeployApiKey in the deployment runner secret."
        )

    archive = artifacts.get("twenty-thinkwork-app")
    if not archive or not archive.is_file():
        raise RuntimeError(
            "Twenty managed app ENABLE/UPGRADE requires release artifact twenty-thinkwork-app."
        )

    target = RELEASE / "extract-twenty-thinkwork-app"
    safe_extract_tar_file(archive, target)
    script = target / "plugins/twenty/scripts/sync-thinkwork-app.mjs"
    app_dir = target / "plugins/twenty/twenty-app"
    if not script.is_file() or not app_dir.is_dir():
        raise RuntimeError(
            "Twenty ThinkWork app artifact must contain "
            "plugins/twenty/scripts/sync-thinkwork-app.mjs and "
            "plugins/twenty/twenty-app."
        )

    env = dict(os.environ)
    env.update(
        {
            "TWENTY_PUBLIC_URL": public_url,
            "TWENTY_APP_SYNC_API_KEY": api_key,
            "TWENTY_THINKWORK_APP_SYNC_DRY_RUN": "0",
            "TWENTY_THINKWORK_APP_DIR": str(app_dir),
        }
    )
    run(["node", str(script), "--apply"], cwd=target, env=env)
    MANAGED_APP_EVIDENCE["twentyThinkWorkApp"] = {
        "status": "installed",
        "artifact": "twenty-thinkwork-app",
        "publicUrl": public_url,
        "operation": managed_app_operation(payload),
    }


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


def ensure_native_auth_custom_attributes(current_outputs):
    """Add the native Entra claims to an existing pool before app clients use them."""
    user_pool_id = str(_current_output_value(current_outputs, "user_pool_id") or "").strip()
    if not user_pool_id:
        return {"status": "skipped", "reason": "user-pool-not-created"}

    def describe_attribute_names():
        raw = output(
            [
                "aws",
                "cognito-idp",
                "describe-user-pool",
                "--user-pool-id",
                user_pool_id,
                "--output",
                "json",
            ]
        )
        described = json.loads(raw or "{}")
        attributes = described.get("UserPool", {}).get("SchemaAttributes", [])
        return {
            str(attribute.get("Name") or "")
            for attribute in attributes
            if isinstance(attribute, dict)
        }

    existing_names = describe_attribute_names()
    missing = [
        attribute
        for attribute in NATIVE_AUTH_CUSTOM_ATTRIBUTES
        if f"custom:{attribute['Name']}" not in existing_names
    ]
    if not missing:
        return {"status": "current", "userPoolId": user_pool_id, "added": []}

    request = {"UserPoolId": user_pool_id, "CustomAttributes": missing}
    run(
        [
            "aws",
            "cognito-idp",
            "add-custom-attributes",
            "--cli-input-json",
            json.dumps(request, separators=(",", ":"), sort_keys=True),
        ],
        stdout=subprocess.DEVNULL,
    )
    reconciled_names = describe_attribute_names()
    unresolved = [
        attribute["Name"]
        for attribute in missing
        if f"custom:{attribute['Name']}" not in reconciled_names
    ]
    if unresolved:
        raise RuntimeError(
            "Cognito native-auth custom attributes were not added: " + ", ".join(unresolved)
        )
    return {
        "status": "reconciled",
        "userPoolId": user_pool_id,
        "added": [attribute["Name"] for attribute in missing],
    }


def write_outputs_to_ssm(outputs_path, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    profile, web_env = runtime_profile(outputs, vars_json)
    mapping = {
        "profile/api-endpoint": "api_endpoint",
        "profile/app-url": "app_url",
        "profile/graphql-http-url": None,
        "profile/appsync-url": "appsync_api_url",
        "profile/appsync-realtime-url": "appsync_realtime_url",
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
        "selected-release-signature-url": vars_json.get(
            "deployment_release_manifest_signature_url"
        ),
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


IDENTITY_PROVIDER_ACTIONS = {"create", "validate", "rotate", "disable"}
ENTRA_TENANT_GUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
ENTRA_PROVIDER_NAME_RE = re.compile(r"^Entra_[a-f0-9]{16}_[a-f0-9]{8}$")


def identity_provider_operation(payload):
    operation = payload.get("operation")
    if not isinstance(operation, dict) or operation.get("kind") != "identity_provider":
        return None
    return operation


def _identity_string(value, label):
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"Identity-provider operation requires {label}")
    return value.strip()


def _current_output_value(current_outputs, key):
    value = current_outputs.get(key) if isinstance(current_outputs, dict) else None
    if isinstance(value, dict) and "value" in value:
        return value.get("value")
    return value


def validate_identity_provider_secret_arn(secret_arn, stage, account_id, region):
    expected = f"arn:aws:secretsmanager:{region}:{account_id}:secret:thinkwork/{stage}/auth/entra/"
    if not isinstance(secret_arn, str) or not secret_arn.startswith(expected):
        raise RuntimeError(
            "Tenant Entra secret ARN must belong to this account, region, stage, "
            "and thinkwork/<stage>/auth/entra namespace"
        )
    return secret_arn


def validate_identity_provider_connection(raw, stage, account_id, region, user_pool_id):
    if not isinstance(raw, dict):
        raise RuntimeError("Identity-provider operation requires safe connection metadata")
    tenant_id = _identity_string(raw.get("tenantId"), "connection.tenantId").lower()
    if not ENTRA_TENANT_GUID_RE.fullmatch(tenant_id):
        raise RuntimeError("Tenant Entra directory ID must be a GUID")
    provider_name = _identity_string(raw.get("providerName"), "connection.providerName")
    if not ENTRA_PROVIDER_NAME_RE.fullmatch(provider_name):
        raise RuntimeError("Tenant Entra provider name is not deterministic")
    connection_key = f"microsoft:tenant:{tenant_id}"
    if raw.get("connectionKey") != connection_key:
        raise RuntimeError("Tenant Entra connection key does not match its directory ID")
    client_id = _identity_string(raw.get("clientId"), "connection.clientId")
    display_name = _identity_string(raw.get("displayName"), "connection.displayName")
    secret_arn = validate_identity_provider_secret_arn(
        raw.get("clientSecretRef"), stage, account_id, region
    )
    client_secret_version_stage = raw.get("clientSecretVersionStage")
    if client_secret_version_stage is not None and client_secret_version_stage != "AWSPENDING":
        raise RuntimeError("Tenant Entra clientSecretVersionStage must be AWSPENDING when supplied")
    bindings = raw.get("tenantBindings")
    if not isinstance(bindings, list) or len(bindings) != 1:
        raise RuntimeError("Tenant Entra connection requires exactly one tenant binding")
    binding = bindings[0]
    if not isinstance(binding, dict):
        raise RuntimeError("Tenant Entra binding must be an object")
    thinkwork_tenant_id = _identity_string(binding.get("tenantId"), "tenant binding ID")
    try:
        uuid.UUID(thinkwork_tenant_id)
    except (ValueError, AttributeError) as error:
        raise RuntimeError("ThinkWork tenant binding ID must be a UUID") from error
    hostnames = binding.get("hostnames")
    if not isinstance(hostnames, list) or not hostnames:
        raise RuntimeError("Tenant Entra binding requires at least one hostname")
    normalized_hostnames = []
    for value in hostnames:
        hostname = _identity_string(value, "tenant binding hostname").lower().rstrip(".")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", hostname):
            raise RuntimeError(f"Invalid tenant auth hostname: {hostname}")
        normalized_hostnames.append(hostname)
    issuer_url = f"https://login.microsoftonline.com/{tenant_id}/v2.0"
    if raw.get("issuerUrl") != issuer_url:
        raise RuntimeError("Tenant Entra issuer must use its tenant GUID v2.0 authority")
    return {
        "connectionKey": connection_key,
        "providerKey": "microsoft",
        "providerKind": "microsoft_tenant",
        "displayName": display_name,
        "lifecycleState": "native",
        "cognitoUserPoolId": _identity_string(user_pool_id, "Cognito user pool ID"),
        "cognitoIdentityProviderName": provider_name,
        "issuerUrl": issuer_url,
        "clientId": client_id,
        "clientSecretRef": secret_arn,
        **(
            {"clientSecretVersionStage": client_secret_version_stage}
            if client_secret_version_stage is not None
            else {}
        ),
        "authorizeScopes": "openid email profile",
        "tenantBindings": [
            {
                "tenantId": thinkwork_tenant_id,
                "label": _identity_string(binding.get("label"), "tenant binding label"),
                "hostnames": sorted(set(normalized_hostnames)),
                "status": "enabled",
            }
        ],
        # Kept in runner/SSM safe state for the Terraform projection only.
        "tenantDirectoryId": tenant_id,
    }


def identity_provider_desired_connections(
    payload, *, stage, account_id, region, previous_state, current_outputs
):
    previous = previous_state.get("tenantConnections") or []
    if not isinstance(previous, list):
        raise RuntimeError("Auth reconciliation tenantConnections state must be an array")
    desired = [dict(value) for value in previous if isinstance(value, dict)]
    operation = identity_provider_operation(payload)
    if operation is None:
        return desired

    action = str(operation.get("action") or "").lower()
    if action not in IDENTITY_PROVIDER_ACTIONS:
        raise RuntimeError(f"Unsupported identity-provider action: {action}")
    expected_previous = int(operation.get("expectedPreviousRevision", -1))
    revision = int(operation.get("revision", -1))
    current_revision = int(previous_state.get("desiredRevision") or 0)
    if expected_previous != current_revision or revision != current_revision + 1:
        raise RuntimeError(f"Identity-provider revision conflict: expected {current_revision + 1}")

    user_pool_id = _current_output_value(current_outputs, "user_pool_id")
    connection = validate_identity_provider_connection(
        operation.get("connection"), stage, account_id, region, user_pool_id
    )
    client_secret_version_stage = connection.get("clientSecretVersionStage")
    if action == "rotate" and client_secret_version_stage != "AWSPENDING":
        raise RuntimeError("Tenant Entra rotation requires clientSecretVersionStage AWSPENDING")
    if action != "rotate" and client_secret_version_stage is not None:
        raise RuntimeError(
            "clientSecretVersionStage AWSPENDING is valid only for Tenant Entra rotation"
        )
    existing = next(
        (value for value in desired if value.get("connectionKey") == connection["connectionKey"]),
        None,
    )
    if action == "create" and existing and existing.get("lifecycleState") != "denied":
        raise RuntimeError("Tenant Entra connection already exists; use rotate or validate")
    if action in {"validate", "rotate", "disable"} and not existing:
        raise RuntimeError(f"Tenant Entra connection does not exist for {action}")
    if action in {"validate", "rotate", "disable"} and existing != connection:
        # Disable may change lifecycle; rotate may add only its runner-owned
        # pending-version label. Safe connection metadata must remain exact.
        comparable = dict(existing)
        comparable["lifecycleState"] = "native"
        submitted_comparable = dict(connection)
        comparable.pop("clientSecretVersionStage", None)
        submitted_comparable.pop("clientSecretVersionStage", None)
        if comparable != submitted_comparable:
            raise RuntimeError(
                "Identity-provider metadata differs from the active desired connection"
            )

    desired = [
        value for value in desired if value.get("connectionKey") != connection["connectionKey"]
    ]
    if action == "disable":
        connection["lifecycleState"] = "denied"
        connection["tenantBindings"][0]["status"] = "disabled"
    desired.append(connection)
    return sorted(desired, key=lambda value: value["connectionKey"])


def tenant_entra_terraform_projection(connections):
    projected = []
    for connection in connections:
        if connection.get("lifecycleState") != "native":
            continue
        projected.append(
            {
                "connection_key": connection["connectionKey"],
                "tenant_id": connection["tenantDirectoryId"],
                "provider_name": connection["cognitoIdentityProviderName"],
                "display_name": connection["displayName"],
            }
        )
    return projected


def native_auth_reconciliation_payload(outputs, vars_json, previous_state=None):
    """Build the complete secret-free Cognito desired set from Terraform outputs."""
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    route_manifest = outputs.get("auth_route_clients", {}).get("value") or {}
    if not isinstance(route_manifest, dict):
        raise RuntimeError("auth_route_clients Terraform output must be an object")
    user_pool_id = str(outputs.get("user_pool_id", {}).get("value") or "")
    if not user_pool_id:
        raise RuntimeError("Native auth reconciliation requires user_pool_id output")

    routes = []
    provider_client_ids = {}
    for manifest_key, raw in sorted(route_manifest.items()):
        if not isinstance(raw, dict):
            raise RuntimeError(f"Invalid auth route manifest entry: {manifest_key}")
        provider_names = [str(value) for value in raw.get("provider_names") or []]
        client_id = str(raw.get("client_id") or "")
        for provider_name in provider_names:
            provider_client_ids.setdefault(provider_name, []).append(client_id)
        routes.append(
            {
                "routeKey": str(raw.get("route_key") or ""),
                "clientFamily": str(raw.get("client_family") or ""),
                "cognitoUserPoolId": user_pool_id,
                "cognitoAppClientId": client_id,
                "providerNames": provider_names,
                "explicitAuthFlows": [str(value) for value in raw.get("explicit_auth_flows") or []],
                "redirectUris": [str(value) for value in raw.get("callback_urls") or []],
                "logoutUris": [str(value) for value in raw.get("logout_urls") or []],
                "lifecycleState": str(raw.get("lifecycle_state") or "native"),
            }
        )

    connections = [
        {
            "connectionKey": "local",
            "providerKey": "cognito",
            "providerKind": "local",
            "displayName": "Email and password",
            "lifecycleState": "native",
            "cognitoUserPoolId": user_pool_id,
            "cognitoIdentityProviderName": "COGNITO",
            "authorizeScopes": "openid email profile",
            "tenantBindings": [],
        }
    ]
    if provider_client_ids.get("Google"):
        connections.append(
            {
                "connectionKey": "google",
                "providerKey": "google",
                "providerKind": "google",
                "displayName": "Google",
                "lifecycleState": "native",
                "cognitoUserPoolId": user_pool_id,
                "cognitoIdentityProviderName": "Google",
                "authorizeScopes": "openid email profile",
                "tenantBindings": [],
            }
        )
    if provider_client_ids.get("MicrosoftOrganizations"):
        microsoft_tenant = str(vars_json.get("microsoft_oauth_tenant") or "").lower()
        if microsoft_tenant not in {"common", "organizations", "consumers"} and not re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            microsoft_tenant,
        ):
            raise RuntimeError(
                "Microsoft native auth reconciliation requires microsoft_oauth_tenant to be"
                " an Entra directory GUID or one of: common, organizations, consumers"
            )
        connections.append(
            {
                "connectionKey": "microsoft:organizations",
                "providerKey": "microsoft",
                "providerKind": "microsoft_organizations",
                "displayName": "Microsoft",
                "lifecycleState": "native",
                "cognitoUserPoolId": user_pool_id,
                "cognitoIdentityProviderName": "MicrosoftOrganizations",
                "issuerUrl": (f"https://login.microsoftonline.com/{microsoft_tenant}/v2.0"),
                "authorizeScopes": "openid email profile",
                "tenantBindings": [],
            }
        )

    # Identity-provider operations store the complete tenant connection set in
    # safe SSM state. Standard releases carry it forward; omission is not
    # interpreted as deletion.
    tenant_connections = vars_json.get("auth_tenant_connection_metadata")
    if tenant_connections is None:
        tenant_connections = previous_state.get("tenantConnections") or []
    for connection in tenant_connections:
        if isinstance(connection, dict):
            # tenantDirectoryId is runner-owned projection metadata, not part
            # of the public/API reconciliation contract.
            connections.append(
                {
                    key: value
                    for key, value in connection.items()
                    if key not in {"tenantDirectoryId", "clientSecretVersionStage"}
                }
            )

    desired = {
        "connections": sorted(connections, key=lambda item: item["connectionKey"]),
        "routeClients": sorted(
            routes,
            key=lambda item: f"{item['routeKey']}:{item['clientFamily']}",
        ),
    }
    desired_fingerprint = hashlib.sha256(canonical_json(desired).encode("utf-8")).hexdigest()
    if desired_fingerprint == previous_state.get("desiredFingerprint"):
        return None, previous_state

    previous_revision = int(previous_state.get("revision") or 0)
    payload = {
        "stage": vars_json["stage"],
        "awsAccountId": vars_json["account_id"],
        "awsRegion": vars_json["region"],
        "revision": previous_revision + 1,
        "expectedPreviousRevision": previous_revision,
        "idempotencyKey": str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"thinkwork-auth:{vars_json['stage']}:{previous_revision + 1}:{desired_fingerprint}",
            )
        ),
        "connections": desired["connections"],
        "routeClients": desired["routeClients"],
    }
    payload["manifestFingerprint"] = hashlib.sha256(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    next_state = {
        "revision": payload["revision"],
        "desiredFingerprint": desired_fingerprint,
        "tenantConnections": tenant_connections,
        "desiredRevision": previous_state.get("desiredRevision", 0),
    }
    return payload, next_state


def auth_reconciliation_state(stage):
    name = f"/thinkwork/{stage}/auth/reconciliation/state"
    try:
        encoded = output(
            [
                "aws",
                "ssm",
                "get-parameter",
                "--name",
                name,
                "--query",
                "Parameter.Value",
                "--output",
                "text",
            ]
        )
        return json.loads(encoded)
    except Exception:
        return {}


def _describe_cognito_identity_provider(user_pool_id, provider_name):
    try:
        raw = output(
            [
                "aws",
                "cognito-idp",
                "describe-identity-provider",
                "--user-pool-id",
                user_pool_id,
                "--provider-name",
                provider_name,
                "--output",
                "json",
            ],
            stderr=subprocess.PIPE,
        )
        value = json.loads(raw or "{}")
        return value.get("IdentityProvider") if isinstance(value, dict) else None
    except subprocess.CalledProcessError as error:
        stderr = str(getattr(error, "stderr", "") or "")
        if "ResourceNotFoundException" in stderr:
            return None
        raise RuntimeError(
            "Tenant Entra Cognito identity provider could not be described"
        ) from error
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "Tenant Entra Cognito identity provider returned malformed metadata"
        ) from error


def _read_tenant_entra_secret(connection):
    try:
        args = [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            connection["clientSecretRef"],
        ]
        version_stage = connection.get("clientSecretVersionStage")
        if version_stage:
            args.extend(["--version-stage", version_stage])
        args.extend(
            [
                "--query",
                "SecretString",
                "--output",
                "text",
            ]
        )
        body = output(
            args,
            stderr=subprocess.DEVNULL,
        )
        secret = json.loads(body or "{}")
    except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
        raise RuntimeError("Tenant Entra secret could not be read") from error
    client_id = secret.get("clientId") if isinstance(secret, dict) else None
    client_secret = secret.get("clientSecret") if isinstance(secret, dict) else None
    if (
        client_id != connection["clientId"]
        or not isinstance(client_secret, str)
        or not client_secret
    ):
        raise RuntimeError("Tenant Entra secret document is missing matching credentials")
    return client_secret


def promote_tenant_entra_pending_secret(payload, vars_json):
    operation = identity_provider_operation(payload)
    if operation is None or str(operation.get("action") or "").lower() != "rotate":
        return None
    connection_key = operation["connection"]["connectionKey"]
    connection = next(
        value
        for value in vars_json["auth_tenant_connection_metadata"]
        if value["connectionKey"] == connection_key
    )
    if connection.get("clientSecretVersionStage") != "AWSPENDING":
        raise RuntimeError("Tenant Entra rotation is missing its pending secret version")
    raw = output(
        [
            "aws",
            "secretsmanager",
            "describe-secret",
            "--secret-id",
            connection["clientSecretRef"],
            "--query",
            "VersionIdsToStages",
            "--output",
            "json",
        ],
        stderr=subprocess.DEVNULL,
    )
    versions = json.loads(raw or "{}")
    pending = next(
        (version for version, stages in versions.items() if "AWSPENDING" in stages),
        None,
    )
    current = next(
        (version for version, stages in versions.items() if "AWSCURRENT" in stages),
        None,
    )
    if not pending:
        raise RuntimeError("Tenant Entra pending secret version was not found")
    if pending != current:
        args = [
            "aws",
            "secretsmanager",
            "update-secret-version-stage",
            "--secret-id",
            connection["clientSecretRef"],
            "--version-stage",
            "AWSCURRENT",
            "--move-to-version-id",
            pending,
        ]
        if current:
            args.extend(["--remove-from-version-id", current])
        output(args, stderr=subprocess.DEVNULL)
    return {"status": "promoted", "connectionKey": connection_key}


def _assert_tenant_entra_provider_matches(existing, connection):
    details = existing.get("ProviderDetails") if isinstance(existing, dict) else None
    mapping = existing.get("AttributeMapping") if isinstance(existing, dict) else None
    expected_mapping = {
        "email": "preferred_username",
        "name": "name",
        "username": "sub",
        "custom:entra_tenant_id": "tid",
        "custom:entra_object_id": "oid",
    }
    if (
        not isinstance(existing, dict)
        or existing.get("ProviderName") != connection["cognitoIdentityProviderName"]
        or existing.get("ProviderType") != "OIDC"
        or not isinstance(details, dict)
        or details.get("client_id") != connection["clientId"]
        or str(details.get("oidc_issuer") or "").rstrip("/") != connection["issuerUrl"].rstrip("/")
        or details.get("authorize_scopes") != "openid email profile"
        or mapping != expected_mapping
    ):
        raise RuntimeError("Tenant Entra Cognito identity provider has drifted")


def reconcile_identity_provider_resource(payload, vars_json):
    operation = identity_provider_operation(payload)
    if operation is None:
        return None
    action = str(operation["action"]).lower()
    connection_key = operation["connection"]["connectionKey"]
    connection = next(
        value
        for value in vars_json["auth_tenant_connection_metadata"]
        if value["connectionKey"] == connection_key
    )
    user_pool_id = connection["cognitoUserPoolId"]
    provider_name = connection["cognitoIdentityProviderName"]
    existing = _describe_cognito_identity_provider(user_pool_id, provider_name)

    if action == "disable":
        return {
            "action": action,
            "connectionKey": connection_key,
            "providerName": provider_name,
            "status": "pending_route_removal",
        }

    # Validation intentionally reads the secret as well: a provider whose
    # referenced credential is inaccessible or malformed is not valid.
    client_secret = _read_tenant_entra_secret(connection)
    if action == "validate":
        if existing is None:
            raise RuntimeError("Tenant Entra Cognito identity provider does not exist")
        _assert_tenant_entra_provider_matches(existing, connection)
        return {
            "action": action,
            "connectionKey": connection_key,
            "providerName": provider_name,
            "status": "valid",
        }

    cli_input = {
        "UserPoolId": user_pool_id,
        "ProviderName": provider_name,
        "ProviderDetails": {
            "client_id": connection["clientId"],
            "client_secret": client_secret,
            "attributes_request_method": "GET",
            "oidc_issuer": connection["issuerUrl"],
            "authorize_scopes": "openid email profile",
        },
        "AttributeMapping": {
            "email": "preferred_username",
            "name": "name",
            "username": "sub",
            "custom:entra_tenant_id": "tid",
            "custom:entra_object_id": "oid",
        },
        "IdpIdentifiers": [],
    }
    aws_action = "update-identity-provider" if existing else "create-identity-provider"
    try:
        subprocess.run(
            [
                "aws",
                "cognito-idp",
                aws_action,
                "--cli-input-json",
                "file:///dev/stdin",
                "--output",
                "json",
            ],
            input=json.dumps(cli_input, separators=(",", ":")),
            text=True,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError as error:
        raise RuntimeError("Tenant Entra Cognito reconciliation failed") from error
    described = _describe_cognito_identity_provider(user_pool_id, provider_name)
    _assert_tenant_entra_provider_matches(described, connection)
    return {
        "action": action,
        "connectionKey": connection_key,
        "providerName": provider_name,
        "status": "reconciled",
    }


def finalize_disabled_identity_provider(payload, vars_json):
    operation = identity_provider_operation(payload)
    if operation is None or str(operation.get("action") or "").lower() != "disable":
        return None
    connection = operation["connection"]
    user_pool_id = next(
        value["cognitoUserPoolId"]
        for value in vars_json["auth_tenant_connection_metadata"]
        if value["connectionKey"] == connection["connectionKey"]
    )
    provider_name = connection["providerName"]
    if _describe_cognito_identity_provider(user_pool_id, provider_name) is not None:
        try:
            output(
                [
                    "aws",
                    "cognito-idp",
                    "delete-identity-provider",
                    "--user-pool-id",
                    user_pool_id,
                    "--provider-name",
                    provider_name,
                ],
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError as error:
            raise RuntimeError("Tenant Entra Cognito provider could not be disabled") from error
    return {
        "action": "disable",
        "connectionKey": connection["connectionKey"],
        "providerName": provider_name,
        "status": "disabled",
    }


def record_identity_provider_operation_state(payload, vars_json):
    operation = identity_provider_operation(payload)
    if operation is None:
        return
    current = auth_reconciliation_state(vars_json["stage"])
    expected = int(operation["expectedPreviousRevision"])
    if int(current.get("desiredRevision") or 0) != expected:
        raise RuntimeError("Identity-provider desired revision changed during reconciliation")
    current["desiredRevision"] = int(operation["revision"])
    current["tenantConnections"] = [
        {key: value for key, value in connection.items() if key != "clientSecretVersionStage"}
        for connection in vars_json["auth_tenant_connection_metadata"]
    ]
    run(
        [
            "aws",
            "ssm",
            "put-parameter",
            "--overwrite",
            "--type",
            "String",
            "--name",
            f"/thinkwork/{vars_json['stage']}/auth/reconciliation/state",
            "--value",
            json.dumps(current, separators=(",", ":")),
        ]
    )


def reconcile_native_auth_metadata(outputs_path, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    previous = auth_reconciliation_state(vars_json["stage"])
    payload, next_state = native_auth_reconciliation_payload(outputs, vars_json, previous)
    if payload is None:
        return {"status": "unchanged", "revision": previous.get("revision", 0)}
    api_endpoint = str(outputs.get("api_endpoint", {}).get("value") or "").rstrip("/")
    api_auth_secret = str(vars_json.get("api_auth_secret") or "")
    if not api_endpoint or not api_auth_secret:
        raise RuntimeError("Native auth reconciliation requires API endpoint and service auth")
    request = urllib.request.Request(
        f"{api_endpoint}/api/auth/providers/reconcile",
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_auth_secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        safe_body = error.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(
            f"Native auth metadata reconciliation failed with HTTP {error.code}: {safe_body}"
        ) from error
    run(
        [
            "aws",
            "ssm",
            "put-parameter",
            "--overwrite",
            "--type",
            "String",
            "--name",
            f"/thinkwork/{vars_json['stage']}/auth/reconciliation/state",
            "--value",
            json.dumps(next_state, separators=(",", ":")),
        ]
    )
    return {
        "status": str(result.get("status") or "applied"),
        "revision": int(result.get("revision") or payload["revision"]),
        "manifestFingerprint": payload["manifestFingerprint"],
    }


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
        version = (pointer.get("activeRelease") or pointer.get("targetRelease") or {}).get(
            "version"
        ) or "unknown"
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
        "managedApps": {"twenty": False},
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
    if MANAGED_APP_EVIDENCE:
        evidence["managedAppPostInstall"] = MANAGED_APP_EVIDENCE
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
    if action not in {
        "deploy",
        "update",
        "destroy",
        "plan",
        "apply",
        "recover",
        "status",
        "web",
    }:
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

    if action == "recover":
        CONTROLLER_EVIDENCE = {
            "incidentRecovery": recover_tei_v380_incident(payload),
        }
        write_evidence(
            "succeeded",
            {
                "stage": "tei-e2e",
                "account_id": "637423202447",
                "region": "us-east-1",
            },
            0,
        )
        return 0

    terraform_phase = validate_terraform_execution_phase(payload, action)
    planned_action = requested_plan_action(payload, action)
    execution_effect_action = planned_action if terraform_phase == "apply" else action
    runner_secrets = secret_payload(payload)
    web_only = is_web_only_operation(payload, action)
    identity_operation = identity_provider_operation(payload)
    static_files = {}
    release_request = release_sync_request(execution_effect_action, payload, identity_operation)
    control_runtime_operation = requires_agentcore_control_runtime(
        execution_effect_action, payload, identity_operation
    )
    if release_request is not None:
        static_files = sync_release_artifacts(**release_request)
    elif control_runtime_operation:
        # Plan and destroy still execute AgentCore local-exec wrappers for
        # existing resources. Download the content-addressed platform bundle
        # without publishing application artifacts so those paths never depend
        # on an ambient CodeBuild SDK.
        sync_release_artifacts(artifact_types=set())
    managed_app_artifacts = stage_managed_app_release_artifacts(action, payload)
    vars_json = write_runner_files(payload, runner_secrets)
    if control_runtime_operation:
        prepare_agentcore_control_runtime()
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

    if identity_operation is not None:
        CONTROLLER_EVIDENCE["identityProvider"] = reconcile_identity_provider_resource(
            payload, vars_json
        )

    configure_cloudflare_provider_auth(vars_json["stage"])
    configure_terraform_provider_mirror()
    run(["terraform", "init", "-backend-config=backend.hcl", "-no-color"], cwd=TF)
    patch_downloaded_customer_domain_module()
    workspace = terraform_workspace_name(vars_json["stage"], payload)
    if workspace != "default":
        selected = subprocess.run(
            ["terraform", "workspace", "select", workspace, "-no-color"],
            cwd=TF,
            text=True,
        )
        if selected.returncode != 0:
            run(["terraform", "workspace", "new", workspace, "-no-color"], cwd=TF)
    state_identity = terraform_state_identity()
    target_args = managed_app_terraform_target_args(payload)
    pre_app_schema = (
        prepare_additive_schema_before_app(payload, vars_json)
        if terraform_phase in {"plan", "legacy"}
        else None
    )
    if terraform_phase == "legacy" and should_reconcile_native_auth_schema(
        terraform_phase, planned_action, payload
    ):
        CONTROLLER_EVIDENCE["cognitoSchema"] = ensure_native_auth_custom_attributes(
            current_terraform_outputs(vars_json["stage"])
        )
    applied_plan = None
    if terraform_phase == "apply":
        applied_plan = validate_and_materialize_approved_plan(payload, state_identity)
        planned_action = applied_plan.get("plannedAction")
        if planned_action not in {"deploy", "update", "destroy"}:
            raise RuntimeError("Approved plan has an invalid plannedAction")
        TERRAFORM_EVIDENCE["approvedPlan"] = applied_plan
        if should_reconcile_native_auth_schema(terraform_phase, planned_action, payload):
            CONTROLLER_EVIDENCE["cognitoSchema"] = ensure_native_auth_custom_attributes(
                current_terraform_outputs(vars_json["stage"])
            )
        result = subprocess.run(
            ["terraform", "apply", "-no-color", "tfplan"],
            cwd=TF,
            text=True,
        )
    elif pre_app_schema is not None and pre_app_schema.returncode != 0:
        result = pre_app_schema
    else:
        result = execute_terraform_plan_phase(
            payload,
            state_identity,
            planned_action,
            terraform_phase,
            target_args,
        )

    outputs_path = TF / "outputs.json"
    if (
        result.returncode == 0
        and terraform_phase in {"apply", "legacy"}
        and planned_action
        in {
            "deploy",
            "update",
        }
    ):
        if identity_operation is not None:
            finalized = finalize_disabled_identity_provider(payload, vars_json)
            if finalized is not None:
                CONTROLLER_EVIDENCE["identityProvider"] = finalized
        write_outputs_after_apply(payload, vars_json, outputs_path)
        if is_managed_app_operation(payload):
            sync_twenty_thinkwork_app(
                outputs_path,
                vars_json,
                payload,
                runner_secrets,
                managed_app_artifacts,
            )
        elif identity_operation is not None:
            CONTROLLER_EVIDENCE["authReconciliation"] = reconcile_native_auth_metadata(
                outputs_path, vars_json
            )
            promoted = promote_tenant_entra_pending_secret(payload, vars_json)
            if promoted is not None:
                CONTROLLER_EVIDENCE["identityProviderSecret"] = promoted
            write_outputs_to_ssm(outputs_path, vars_json)
            record_identity_provider_operation_state(payload, vars_json)
        else:
            CONTROLLER_EVIDENCE["authReconciliation"] = reconcile_native_auth_metadata(
                outputs_path, vars_json
            )
            # Destructive retirement migrations are permitted only after the
            # deployed native routes have reconciled successfully.
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
