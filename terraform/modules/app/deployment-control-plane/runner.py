import hashlib
import json
import os
import secrets
import subprocess
import tarfile
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

WORK = Path("/tmp/thinkwork-platform-deploy")
RELEASE = WORK / "release"
SOURCE = WORK / "source"
TF = WORK / "terraform"
MANIFEST = RELEASE / "thinkwork-release.json"
STARTED_AT = datetime.now(timezone.utc).isoformat()


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


def source_repo_and_ref(module_source, release_version):
    source = module_source.removeprefix("git::")
    source_path, _, query = source.partition("?")
    params = urllib.parse.parse_qs(query)
    ref = params.get("ref", [release_version])[0]
    if ".git//" in source_path:
        repo = source_path.split(".git//", 1)[0] + ".git"
    elif "//terraform/" in source_path:
        repo = source_path.split("//terraform/", 1)[0]
    else:
        repo = source_path
    return repo, ref


def checkout_source(module_source, release_version):
    if SOURCE.exists():
        return
    repo, ref = source_repo_and_ref(module_source, release_version)
    if not repo.startswith(("https://", "git@")):
        raise RuntimeError(f"Cannot initialize database schema from module source: {module_source}")
    run(["git", "clone", "--depth", "1", "--branch", ref, repo, str(SOURCE)])


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
    files = sorted(
        path
        for path in migrations.glob("*.sql")
        if "rollback" not in path.name
    )
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


def push_database_schema(outputs_path, vars_json):
    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    checkout_source(
        os.environ["THINKWORK_TERRAFORM_MODULE_SOURCE"],
        os.environ.get("THINKWORK_RELEASE_VERSION", "main"),
    )
    database_url = database_url_from_outputs(outputs)
    if psql_output(database_url, "SELECT to_regclass('public.tenants')").strip():
        return
    initialize_greenfield_database(database_url, outputs, vars_json)


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

    release_version = safe_get(
        payload,
        "releaseVersion",
        default=os.environ.get("THINKWORK_RELEASE_VERSION", "unresolved"),
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
    module_version_line = (
        f"  version = {hcl_string(module_version)}\n"
        if module_version
        else ""
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
        f'''
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

module "thinkwork" {{
  source  = {hcl_string(module_source)}
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
  deployment_release_version         = {hcl_string(release_version)}
  deployment_release_manifest_url    = {hcl_string(os.environ.get("THINKWORK_RELEASE_MANIFEST_URL", ""))}
  deployment_release_manifest_sha256 = {hcl_string(os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256", ""))}
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
''',
        encoding="utf-8",
    )
    return vars_json


def sync_release_artifacts():
    manifest_url = os.environ.get("THINKWORK_RELEASE_MANIFEST_URL")
    expected = os.environ.get("THINKWORK_RELEASE_MANIFEST_SHA256", "").lower()
    if not manifest_url:
        raise RuntimeError("THINKWORK_RELEASE_MANIFEST_URL is required")
    download(manifest_url, MANIFEST)
    actual = sha256_file(MANIFEST)
    if expected and actual != expected:
        raise RuntimeError(
            f"Release manifest digest mismatch: expected {expected}, got {actual}"
        )

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    lambda_prefix = f"releases/{os.environ['THINKWORK_RELEASE_VERSION']}/lambdas"
    static_files = {}
    for artifact in manifest.get("artifacts", []):
        if artifact.get("type") not in {"lambda", "static-site"}:
            continue
        url = artifact.get("url")
        if not url:
            raise RuntimeError(f"Release artifact {artifact.get('name')} is missing url")
        destination = RELEASE / artifact["relativePath"]
        download(url, destination)
        digest = sha256_file(destination)
        if digest != artifact.get("sha256"):
            raise RuntimeError(f"Artifact digest mismatch for {artifact.get('name')}")
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
        "issuedAt": datetime.now(timezone.utc).isoformat(),
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
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(target)
        run(["aws", "s3", "sync", "--delete", str(target), f"s3://{bucket}/"])
        if artifact_name == "web":
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
        "recordedAt": datetime.now(timezone.utc).isoformat(),
    }
    if error:
        evidence["error"] = str(error)
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
    WORK.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("CLOUDFLARE_API_TOKEN", "placeholder-not-configured")
    payload = read_json_env("THINKWORK_DEPLOYMENT_INPUT", {})
    action = os.environ.get("THINKWORK_DEPLOYMENT_ACTION") or payload.get("action") or "deploy"
    if action == "teardown":
        action = "destroy"
    if action not in {"deploy", "destroy", "plan"}:
        raise RuntimeError(f"Unsupported deployment action: {action}")

    runner_secrets = secret_payload(payload)
    static_files = sync_release_artifacts() if action == "deploy" else {}
    vars_json = write_runner_files(payload, runner_secrets)
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
        result = subprocess.run(
            ["terraform", "destroy", "-auto-approve", "-no-color"],
            cwd=TF,
            text=True,
        )
    else:
        plan = subprocess.run(
            ["terraform", "plan", "-out=tfplan", "-no-color"],
            cwd=TF,
            text=True,
        )
        if action == "plan" or plan.returncode != 0:
            result = plan
        else:
            result = subprocess.run(
                ["terraform", "apply", "-auto-approve", "-no-color", "tfplan"],
                cwd=TF,
                text=True,
            )

    outputs_path = TF / "outputs.json"
    if result.returncode == 0 and action == "deploy":
        outputs_path.write_text(output(["terraform", "output", "-json"], cwd=TF), encoding="utf-8")
        push_database_schema(outputs_path, vars_json)
        write_outputs_to_ssm(outputs_path, vars_json)
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
