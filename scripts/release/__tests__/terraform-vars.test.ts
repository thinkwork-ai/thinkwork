import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * Executes scripts/deploy/terraform-vars.sh and inspects what it actually
 * produces.
 *
 * Name-level comparison against the old inline block is not enough. That
 * block was interpolated by GitHub *before* bash ever saw it, so
 * `'${{ vars.X || '[]' }}'` was correctly single-quoted; moved into a shell
 * script verbatim, the same quotes export the literal string
 * `${EXTERNAL_KB_SOURCE_ARNS_JSON:-[]}` and Terraform rejects it as a list.
 * The names matched perfectly while the value was broken, which is why this
 * runs the script instead of reading it.
 */

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../deploy/terraform-vars.sh");

/**
 * Supplied by the workflow's `env:` block, which maps ${{ secrets.* }} and
 * ${{ vars.* }} — expressions a shell script cannot evaluate.
 */
const FROM_ENV_BLOCK: Record<string, string> = {
  GITHUB_WORKSPACE: "/tmp/ws",
  STAGE: "dev",
  AWS_REGION: "us-east-1",
  AWS_ACCOUNT_ID: "111122223333",
  DB_PASSWORD: "pw-marker",
  API_AUTH_SECRET: "auth-marker",
  GOOGLE_OAUTH_CLIENT_ID: "goog-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "goog-secret",
  MICROSOFT_OAUTH_CLIENT_ID: "ms-id",
  MICROSOFT_OAUTH_CLIENT_SECRET: "ms-secret",
  MICROSOFT_OAUTH_TENANT: "ms-tenant",
  THINKWORK_PLATFORM_OPERATOR_EMAILS: "op@example.com",
  // Referenced without a `:-` fallback, mirroring `${{ vars.X }}` entries
  // that carry no `||` default. The env block always defines them, so an
  // empty string is the real-world value when the repo variable is unset.
  WWW_DOMAIN: "",
  CLOUDFLARE_ZONE_ID: "",
  MCP_CUSTOM_DOMAIN: "",
};

/**
 * Supplied by the "Resolve Twenty CRM deployment inputs" and "Resolve n8n
 * deployment inputs" steps, which write to $GITHUB_ENV at runtime.
 *
 * This set is the reason a standalone read-only plan workflow was abandoned:
 * these values do not exist until those steps run, and one of them
 * ("Prepare Twenty CRM runtime secrets and database") creates AWS secrets.
 * A plan built without them dies on `TWENTY_PROVISIONED: unbound variable`.
 */
const FROM_RESOLVE_STEPS: Record<string, string> = {
  TWENTY_PROVISIONED: "false",
  TWENTY_RUNTIME_ENABLED: "false",
  TWENTY_IMAGE_URI: "",
  TWENTY_DB_USERNAME: "thinkwork_twenty",
  TWENTY_DB_NAME: "thinkwork_twenty",
  TWENTY_DB_URL_SECRET_ARN: "",
  TWENTY_ENCRYPTION_KEY_SECRET_ARN: "",
  TWENTY_PUBLIC_URL: "",
  TWENTY_CERTIFICATE_ARN: "",
  N8N_PROVISIONED: "false",
  N8N_RUNTIME_ENABLED: "false",
  N8N_IMAGE_URI: "",
  N8N_DATABASE_ADMIN_SECRET_ARN: "",
  N8N_DATABASE_URL_SECRET_ARN: "",
  N8N_DB_USERNAME: "thinkwork_n8n",
  N8N_DB_NAME: "thinkwork_n8n",
  N8N_ENCRYPTION_KEY_SECRET_ARN: "",
  N8N_OPERATOR_SECRET_ARN: "",
  N8N_SERVICE_CREDENTIAL_SECRET_ARN: "",
  N8N_STORAGE_BUCKET_NAME: "",
  N8N_DOMAIN: "",
  N8N_PUBLIC_URL: "",
  N8N_CERTIFICATE_ARN: "",
  N8N_CONTAINER_PORT: "3000",
  N8N_CACHE_ENGINE: "none",
};

const ENV: Record<string, string> = {
  ...FROM_ENV_BLOCK,
  ...FROM_RESOLVE_STEPS,
};

async function run(overrides: Record<string, string> = {}) {
  // `set -u` is on inside the script; unset optional inputs must still be
  // tolerated, which is itself part of what this exercises.
  const { stdout } = await exec(
    "bash",
    [
      "-c",
      `set -euo pipefail
       source "${SCRIPT}"
       printf '%s\\n' "\${TF_VAR_ARGS[@]}"
       echo "---EXPORTS---"
       env | grep '^TF_VAR_' | sort`,
    ],
    { env: { PATH: process.env.PATH ?? "", ...ENV, ...overrides } },
  );
  const [argsBlock, exportsBlock] = stdout.split("---EXPORTS---");
  const flat = argsBlock.trim().split("\n");
  const vars = new Map<string, string>();
  for (const entry of flat) {
    if (entry === "-var") continue;
    const eq = entry.indexOf("=");
    if (eq > 0) vars.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  const exports = new Map<string, string>();
  for (const line of exportsBlock.trim().split("\n")) {
    const eq = line.indexOf("=");
    exports.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return { vars, exports };
}

test("no variable carries an unexpanded shell expression", async () => {
  const { vars, exports } = await run();
  for (const [name, value] of [...vars, ...exports]) {
    assert.ok(!value.includes("${"), `${name} was not expanded: ${value}`);
  }
});

test("the list-typed KB var expands to the JSON it was given", async () => {
  const json = '["arn:aws:s3:::alpha","arn:aws:s3:::beta"]';
  const { exports } = await run({ EXTERNAL_KB_SOURCE_ARNS_JSON: json });
  assert.equal(exports.get("TF_VAR_external_kb_source_arns"), json);

  const { exports: empty } = await run();
  assert.equal(empty.get("TF_VAR_external_kb_source_arns"), "[]");
});

test("secrets reach Terraform as values, not names", async () => {
  const { exports } = await run();
  assert.equal(exports.get("TF_VAR_db_password"), "pw-marker");
  assert.equal(exports.get("TF_VAR_api_auth_secret"), "auth-marker");
  assert.equal(exports.get("TF_VAR_microsoft_oauth_tenant"), "ms-tenant");
});

test("defaults match the inline block they replaced", async () => {
  const { vars } = await run();
  assert.equal(vars.get("auth_retirement_phase"), "retired");
  assert.equal(vars.get("stripe_price_ids_json"), "{}");
  assert.equal(vars.get("wiki_source"), "planner");
});

test("the coexistence auth phase still demands an RFC3339 deadline", async () => {
  // This validation guarded a real footgun; extraction must not drop it.
  await assert.rejects(() => run({ AUTH_RETIREMENT_PHASE: "coexistence" }));
  await assert.rejects(() =>
    run({
      AUTH_RETIREMENT_PHASE: "coexistence",
      AUTH_MIGRATION_RECOVERY_DEADLINE: "tomorrow",
    }),
  );

  // The accept case needs `date --date=`, which is GNU-only. Runners are
  // ubuntu; a macOS checkout would otherwise fail on BSD date, not on a
  // real defect.
  const gnuDate = await exec("date", [
    "--date=2026-08-01T00:00:00Z",
    "+%s",
  ]).then(
    () => true,
    () => false,
  );
  if (!gnuDate) return;
  await run({
    AUTH_RETIREMENT_PHASE: "coexistence",
    AUTH_MIGRATION_RECOVERY_DEADLINE: "2026-08-01T00:00:00Z",
  });
});

test("produces the full variable set", async () => {
  const { vars } = await run();
  // 58 -var flags: 65 at extraction, minus capability_self_extension_tenants
  // (self-extension removal), analyst vars (#4137), the ontology/KG pair
  // (THINK-408), and the hindsight/memory-engine trio (THINK-407).
  // A change here is fine — an unnoticed change is not.
  assert.equal(vars.size, 58);
});
