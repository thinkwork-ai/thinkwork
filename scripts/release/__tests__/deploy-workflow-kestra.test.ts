import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

test("deploy workflow wires Kestra through normal Terraform deploy path", () => {
  for (const expected of [
    "Resolve Kestra deployment inputs",
    "Prepare Kestra runtime secrets and database",
    "Empty Kestra retained storage before destructive destroy",
    "Restart Kestra runtime after database prep",
    "Destroy Kestra retained data",
    '-var "kestra_provisioned=$KESTRA_PROVISIONED"',
    '-var "kestra_runtime_enabled=$KESTRA_RUNTIME_ENABLED"',
    '-var "kestra_image_uri=$KESTRA_IMAGE_URI"',
    '-var "kestra_db_password_secret_arn=$KESTRA_DB_PASSWORD_SECRET_ARN"',
    '-var "kestra_basic_auth_secret_arn=$KESTRA_BASIC_AUTH_SECRET_ARN"',
    '-var "kestra_storage_force_destroy=$KESTRA_STORAGE_FORCE_DESTROY"',
    '-var "kestra_allowed_public_cidr_blocks=$KESTRA_ALLOWED_PUBLIC_CIDR_BLOCKS"',
    '-var "kestra_kms_key_arns=$KESTRA_KMS_KEY_ARNS"',
    "KESTRA_DESTROY_DATA=true requires KESTRA_PROVISIONED=false and KESTRA_RUNTIME_ENABLED=false.",
  ]) {
    assert.match(workflow, new RegExp(escapeRegExp(expected)));
  }
});

test("deploy workflow keeps Kestra credentials in Secrets Manager", () => {
  assert.match(workflow, /KESTRA_DB_PASSWORD_SECRET_ID/);
  assert.match(workflow, /KESTRA_BASIC_AUTH_SECRET_ID/);
  assert.match(workflow, /aws secretsmanager create-secret/);
  assert.match(workflow, /aws secretsmanager put-secret-value/);
  assert.doesNotMatch(workflow, /KESTRA_BASIC_AUTH_PASSWORD_INPUT/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
