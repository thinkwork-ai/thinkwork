/**
 * Structural fixture tests for the SSM runtime-config migration
 * (plan 2026-06-11-006, R1/R2/R10).
 *
 * graphql-http hit Lambda's hard 4KB env ceiling three times (#2375 chain);
 * the fix moved all config-class keys into one SSM parameter per stage.
 * These assertions are the R10 guardrail: a PR that grows common_env past
 * the identity allowlist fails HERE with an explanation, instead of failing
 * a customer terraform apply at deploy time.
 *
 * Pure file-content assertions — runnable without AWS credentials.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const HANDLERS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/handlers.tf",
);
const RUNTIME_CONFIG = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/runtime-config.tf",
);

const read = (path: string) => readFileSync(path, "utf8");

/**
 * The ONLY keys allowed in Lambda env for api handlers (R1).
 *
 * - Identity: STAGE, AWS_ACCOUNT_ID, NODE_OPTIONS (FUNCTION_NAME is merged
 *   per-function at the aws_lambda_function resource).
 * - Transition window (R8): DATABASE_URL, APPSYNC_API_KEY, API_AUTH_SECRET
 *   stay one release while the Secrets Manager prefetch path soaks on dev;
 *   the follow-up release deletes them from this list AND from common_env.
 *
 * Adding a key here is the wrong fix for "my handler needs config": put the
 * value in the runtime_config locals (config_env / graphql_http_config_env)
 * and read it with getConfig() from @thinkwork/runtime-config. Per-handler
 * behavior gates in handler_extra_env are not covered by this allowlist.
 */
const COMMON_ENV_ALLOWLIST = new Set([
  "STAGE",
  "AWS_ACCOUNT_ID",
  "NODE_OPTIONS",
  // R8 transition window — drop next release:
  "DATABASE_URL",
  "APPSYNC_API_KEY",
  "API_AUTH_SECRET",
]);

/** Extract the literal `common_env = { ... }` block from handlers.tf. */
function commonEnvBlock(source: string): string {
  const start = source.indexOf("common_env = {");
  expect(start, "common_env literal block must exist").toBeGreaterThan(-1);
  const rest = source.slice(start);
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    if (rest[i] === "}") {
      depth--;
      if (depth === 0) return rest.slice(0, i + 1);
    }
  }
  throw new Error("unterminated common_env block");
}

describe("R1/R10 — Lambda env stays identity-only", () => {
  it("keeps common_env a flat literal map (no merged config locals)", () => {
    const block = commonEnvBlock(read(HANDLERS));
    expect(block).not.toMatch(/merge\(/);
    expect(block).not.toMatch(/local\.config_env/);
    expect(block).not.toMatch(/local\.graphql_http_config_env/);
  });

  it("keeps every common_env key inside the identity allowlist", () => {
    const block = commonEnvBlock(read(HANDLERS));
    const keys = [...block.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\s*=/gm)].map(
      (m) => m[1],
    );
    expect(keys.length).toBeGreaterThan(0);
    const offenders = keys.filter((k) => !COMMON_ENV_ALLOWLIST.has(k));
    expect(
      offenders,
      `New env keys on every api handler rebuild the 4KB ceiling (#2375). ` +
        `Move config into the runtime_config SSM document (config_env local) ` +
        `and read it via getConfig() instead: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("does not reintroduce derivable thinkwork-<stage>-api-* function names as env", () => {
    const handlers = read(HANDLERS);
    // deriveFunctionName/runtimeFunctionName compute these at call time (R7).
    expect(handlers).not.toMatch(
      /[A-Z_]+_FUNCTION_NAME\s*=\s*"thinkwork-\$\{var\.stage\}-api-/,
    );
  });
});

describe("R2 — terraform-owned runtime-config document", () => {
  it("provisions one advanced-tier SSM parameter per stage with a 7KB plan-time ceiling", () => {
    const source = read(RUNTIME_CONFIG);
    expect(source).toMatch(/resource "aws_ssm_parameter" "runtime_config"/);
    expect(source).toMatch(
      /name = "\/thinkwork\/\$\{var\.stage\}\/runtime-config"/,
    );
    expect(source).toMatch(/tier\s+= "Advanced"/);
    expect(source).toMatch(/precondition/);
    expect(source).toMatch(/< 7168/);
  });

  it("renders the document from the same locals that fed common_env", () => {
    const source = read(RUNTIME_CONFIG);
    expect(source).toMatch(/local\.config_env/);
    expect(source).toMatch(/local\.graphql_http_config_env/);
  });

  it("attaches the Parameters-and-Secrets extension layer to api handlers", () => {
    expect(read(HANDLERS)).toMatch(/layers = local\.api_handler_layers/);
    expect(read(RUNTIME_CONFIG)).toMatch(
      /AWS-Parameters-and-Secrets-Lambda-Extension/,
    );
  });

  it("orders the document and platform secrets before function env updates", () => {
    expect(read(HANDLERS)).toMatch(
      /depends_on = \[\s*aws_ssm_parameter\.runtime_config,/,
    );
  });
});

/** Extract literal `KEY = ...` names from a named locals block. */
function literalKeys(source: string, blockStart: string): string[] {
  const start = source.indexOf(blockStart);
  expect(start, `${blockStart} block must exist`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  let depth = 0;
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "{" || rest[i] === "(") depth++;
    if (rest[i] === "}" || rest[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return [...rest.slice(0, end).matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*=/gm)].map(
    (m) => m[1],
  );
}

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walkTs(p);
    else if (/\.(ts|tsx|mts)$/.test(entry)) yield p;
  }
}

describe("R10 — every document-only key has zero remaining direct process.env readers", () => {
  // The exact bug class behind the 2026-06-11 review's P0/P1 findings:
  // a key was removed from Lambda env, but a reader still consumed it via
  // process.env (directly, or through an injected env object), so it broke
  // only at runtime. This test makes the next missed reader a CI failure.
  //
  // Intentional exceptions go here with a reason, e.g.
  // "packages/api/src/foo.ts" — env-injection seam, getConfig fallback added.
  const ALLOWED: Record<string, string[]> = {};

  it("finds no process.env.<doc-key> reads in packages/{api,lambda,database-pg}", () => {
    const handlers = read(HANDLERS);
    const docKeys = [
      ...literalKeys(handlers, "config_env = merge({"),
      // Plain map since the U10 Twenty cutover removed the twenty_env merge.
      ...literalKeys(handlers, "graphql_http_config_env = {"),
    ];
    expect(docKeys.length).toBeGreaterThan(20);

    const keyAlt = docKeys.join("|");
    const readRe = new RegExp(
      String.raw`process\.env\.(${keyAlt})(?![A-Za-z0-9_$])`,
      "g",
    );

    const offenders: string[] = [];
    for (const pkg of [
      "packages/api",
      "packages/lambda",
      "packages/database-pg/src",
    ]) {
      for (const file of walkTs(resolve(REPO_ROOT, pkg))) {
        const rel = relative(REPO_ROOT, file);
        if (/\.test\.(ts|tsx)$/.test(file)) continue;
        if (/(^|\/)(__tests__|__smoke__|test|tests|scripts)\//.test(rel))
          continue;
        const src = readFileSync(file, "utf8");
        for (const match of src.matchAll(readRe)) {
          const key = match[1];
          if (ALLOWED[rel]?.includes(key)) continue;
          // writes / deletes are test-setup style mutations, not reads
          const after = src.slice(
            match.index! + match[0].length,
            match.index! + match[0].length + 4,
          );
          const before = src.slice(Math.max(0, match.index! - 8), match.index!);
          if (/delete\s+$/.test(before) || /^\s*=[^=]/.test(after)) continue;
          offenders.push(`${rel}: process.env.${key}`);
        }
      }
    }

    expect(
      offenders,
      `These keys live only in the SSM runtime-config document — reading ` +
        `process.env returns undefined in production. Use getConfig("<KEY>") ` +
        `from @thinkwork/runtime-config (env still wins when set):\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("R4 — secrets live in Secrets Manager, never the String document", () => {
  it("provisions the api-auth and appsync-api-key secrets under thinkwork/<stage>/", () => {
    const source = read(RUNTIME_CONFIG);
    expect(source).toMatch(/"thinkwork\/\$\{var\.stage\}\/api-auth"/);
    expect(source).toMatch(/"thinkwork\/\$\{var\.stage\}\/appsync-api-key"/);
  });

  it("keeps secret values out of the runtime-config document locals", () => {
    const handlers = read(HANDLERS);
    const configEnvStart = handlers.indexOf("config_env = merge({");
    expect(configEnvStart).toBeGreaterThan(-1);
    const commonStart = handlers.indexOf("common_env = {");
    const configSection = handlers.slice(configEnvStart, commonStart);
    expect(configSection).not.toMatch(/var\.api_auth_secret/);
    expect(configSection).not.toMatch(/var\.appsync_api_key/);
    expect(configSection).not.toMatch(/var\.db_password/);
  });
});
