/**
 * Product-side Neptune wiring for `thinkwork twin install` (THINK-334 U3).
 *
 * KTD-3: the product stack already consumes the three Neptune variables
 * (terraform/modules/thinkwork → app/lambda-api); the install's job is to
 * carry the etl stack's outputs into the stage's variable channel and run
 * the standard deploy path, then verify the value actually landed in the
 * `/thinkwork/<stage>/runtime-config` SSM document (which strips empty
 * values — a missing key means "twin disabled").
 *
 * The channel differs by deployment model:
 *   - dev: GitHub repo variables (deploy.yml passes vars.NEPTUNE_* as
 *     terraform -var flags; GHA vars snapshot at trigger, so set-then-run).
 *   - customer stages: the runner-secrets document
 *     (/thinkwork/<stage>/deployment/runner-secrets Secrets Manager secret)
 *     read by the control-plane runner's vars_json allowlist, then a
 *     controller update deploy. The runner allowlist change must be in the
 *     release the customer runs.
 */

import type { NeptuneOutputs } from "./etl-terraform.js";

// ── Channel key names ────────────────────────────────────────────────────────

/** GitHub repo variable names deploy.yml forwards (dev model). */
export const DEV_GH_VARIABLE_KEYS = {
  neptuneEndpoint: "NEPTUNE_ENDPOINT",
  clusterResourceId: "NEPTUNE_CLUSTER_RESOURCE_ID",
  clientSgId: "NEPTUNE_CLIENT_SG_ID",
  loadBucket: "NEPTUNE_LOAD_BUCKET",
  loaderRoleArn: "NEPTUNE_LOADER_ROLE_ARN",
} as const;

/** camelCase keys inside the customer runner-secrets document. */
export const RUNNER_SECRET_KEYS = {
  neptuneEndpoint: "neptuneEndpoint",
  clusterResourceId: "neptuneClusterResourceId",
  clientSgId: "neptuneClientSecurityGroupId",
  loadBucket: "neptuneLoadBucket",
  loaderRoleArn: "neptuneLoaderRoleArn",
} as const;

export type NeptuneField = keyof typeof DEV_GH_VARIABLE_KEYS;

export const NEPTUNE_FIELDS: NeptuneField[] = [
  "neptuneEndpoint",
  "clusterResourceId",
  "clientSgId",
  "loadBucket",
  "loaderRoleArn",
];

// ── Deployment model ─────────────────────────────────────────────────────────

export type DeployModel = "dev-github" | "customer-controller";

/**
 * dev deploys through .github/workflows/deploy.yml (repo variables); every
 * other stage deploys through its deployment controller + runner secrets.
 */
export function resolveDeployModel(stage: string): DeployModel {
  return stage === "dev" ? "dev-github" : "customer-controller";
}

// ── Channel diff (pure) ──────────────────────────────────────────────────────

export interface ChannelDiffEntry {
  field: NeptuneField;
  current: string | null;
  desired: string;
}

export interface ChannelDiff {
  stale: ChannelDiffEntry[];
  current: boolean;
}

export function computeChannelDiff(
  current: Partial<Record<NeptuneField, string | null>>,
  desired: NeptuneOutputs,
): ChannelDiff {
  const stale: ChannelDiffEntry[] = [];
  for (const field of NEPTUNE_FIELDS) {
    const have = current[field] ?? null;
    const want = desired[field];
    if (have !== want) stale.push({ field, current: have, desired: want });
  }
  return { stale, current: stale.length === 0 };
}

/**
 * Merge the three Neptune keys into a runner-secrets document, touching
 * nothing else (asserted by tests — the document carries unrelated
 * credentials that must survive byte-for-byte).
 */
export function mergeRunnerSecrets(
  documentJson: string,
  desired: NeptuneOutputs,
): string {
  const doc = JSON.parse(documentJson) as Record<string, unknown>;
  doc[RUNNER_SECRET_KEYS.neptuneEndpoint] = desired.neptuneEndpoint;
  doc[RUNNER_SECRET_KEYS.clusterResourceId] = desired.clusterResourceId;
  doc[RUNNER_SECRET_KEYS.clientSgId] = desired.clientSgId;
  doc[RUNNER_SECRET_KEYS.loadBucket] = desired.loadBucket;
  doc[RUNNER_SECRET_KEYS.loaderRoleArn] = desired.loaderRoleArn;
  return JSON.stringify(doc);
}

export function readRunnerSecretChannel(
  documentJson: string,
): Partial<Record<NeptuneField, string | null>> {
  const doc = JSON.parse(documentJson) as Record<string, unknown>;
  const read = (key: string): string | null => {
    const v = doc[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  return {
    neptuneEndpoint: read(RUNNER_SECRET_KEYS.neptuneEndpoint),
    clusterResourceId: read(RUNNER_SECRET_KEYS.clusterResourceId),
    clientSgId: read(RUNNER_SECRET_KEYS.clientSgId),
    loadBucket: read(RUNNER_SECRET_KEYS.loadBucket),
    loaderRoleArn: read(RUNNER_SECRET_KEYS.loaderRoleArn),
  };
}

// ── Runtime-config verification (pure) ───────────────────────────────────────

/**
 * Missing key = empty: the runtime-config document strips empty values, so
 * an absent NEPTUNE_ENDPOINT means the deploy has not carried the value.
 */
export function parseRuntimeConfigNeptuneEndpoint(
  parameterValue: string | null,
): string {
  if (!parameterValue) return "";
  try {
    const doc = JSON.parse(parameterValue) as Record<string, unknown>;
    const v = doc["NEPTUNE_ENDPOINT"];
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

export type WiringState = "current" | "drifted" | "absent";

/**
 * Runtime-config verification is part of the state comparison, not just a
 * post-step: channel values matching but an empty SSM endpoint means a
 * deploy never carried them — classify as drifted and deploy anyway,
 * otherwise re-runs can never converge.
 */
export function classifyWiring(input: {
  channelCurrent: boolean;
  ssmEndpoint: string;
  desiredEndpoint: string;
}): WiringState {
  if (!input.channelCurrent) return "absent";
  if (input.ssmEndpoint !== input.desiredEndpoint) return "drifted";
  return "current";
}

// ── Orchestration (deps injected for tests) ──────────────────────────────────

export interface WiringDeps {
  /** Read the stage's current channel values. */
  readChannel: () => Promise<Partial<Record<NeptuneField, string | null>>>;
  /** Write the three desired values into the channel. */
  writeChannel: (desired: NeptuneOutputs) => Promise<void>;
  /** Execute the stage's standard deploy and wait for the result. */
  runDeploy: () => Promise<void>;
  /** Read the raw /thinkwork/<stage>/runtime-config value (null if absent). */
  readRuntimeConfig: () => Promise<string | null>;
}

export interface WiringOutcome {
  state: "found" | "created" | "failed" | "planned";
  detail: string;
}

export async function syncProductWiring(
  desired: NeptuneOutputs,
  deps: WiringDeps,
  opts: { dryRun: boolean },
): Promise<WiringOutcome> {
  let diff: ChannelDiff;
  try {
    diff = computeChannelDiff(await deps.readChannel(), desired);
  } catch (err) {
    return {
      state: "failed",
      detail: `could not read the variable channel: ${msg(err)}`,
    };
  }

  let ssmEndpoint: string;
  try {
    ssmEndpoint = parseRuntimeConfigNeptuneEndpoint(
      await deps.readRuntimeConfig(),
    );
  } catch (err) {
    return {
      state: "failed",
      detail: `could not read runtime-config SSM: ${msg(err)}`,
    };
  }

  const wiring = classifyWiring({
    channelCurrent: diff.current,
    ssmEndpoint,
    desiredEndpoint: desired.neptuneEndpoint,
  });

  if (wiring === "current") {
    return {
      state: "found",
      detail:
        "Neptune tfvars current and NEPTUNE_ENDPOINT live in runtime-config",
    };
  }

  const describeDiff =
    diff.stale.length > 0
      ? `stale: ${diff.stale.map((s) => s.field).join(", ")}`
      : "channel current but runtime-config lacks NEPTUNE_ENDPOINT (deploy never carried it)";

  if (opts.dryRun) {
    return {
      state: "planned",
      detail: `${describeDiff} — would write channel and deploy (dry-run)`,
    };
  }

  try {
    if (diff.stale.length > 0) await deps.writeChannel(desired);
  } catch (err) {
    return {
      state: "failed",
      detail: `could not write the variable channel: ${msg(err)}`,
    };
  }

  try {
    await deps.runDeploy();
  } catch (err) {
    return { state: "failed", detail: `deploy failed: ${msg(err)}` };
  }

  try {
    const after = parseRuntimeConfigNeptuneEndpoint(
      await deps.readRuntimeConfig(),
    );
    if (after !== desired.neptuneEndpoint) {
      return {
        state: "failed",
        detail:
          "deploy completed but /thinkwork/<stage>/runtime-config still lacks the expected " +
          `NEPTUNE_ENDPOINT (have "${after || "(empty)"}") — the deploy path did not carry ` +
          "the Neptune tfvars (customer stages need the runner vars_json allowlist release).",
      };
    }
  } catch (err) {
    return {
      state: "failed",
      detail: `post-deploy runtime-config verification failed: ${msg(err)}`,
    };
  }

  return {
    state: "created",
    detail: `${describeDiff} — channel written, deploy completed, runtime-config verified`,
  };
}

function msg(err: unknown): string {
  return err instanceof Error
    ? err.message.slice(0, 300)
    : String(err).slice(0, 300);
}
