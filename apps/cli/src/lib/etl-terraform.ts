/**
 * etl-repo Terraform orchestration for `thinkwork twin install` (THINK-334 U2).
 *
 * Drives the etl repo's (thinkwork-ai/company-brain, formerly
 * McPherson-Data/thinkwork) per-account stack machinery
 * from a local checkout: `terraform -chdir=<stack>` with
 * `accounts/<slug>.backend.hcl` + `accounts/<slug>.tfvars`, honoring the
 * repo's `accounts/<slug>.skip-stacks` file, in twin dependency order.
 *
 * Deliberately separate from src/terraform.ts, which is product-repo-shaped
 * (tier dirs, workspaces). The etl repo uses per-stack S3 state with partial
 * backend config and no workspaces.
 *
 * R4 is enforced mechanically by a plan gate before every apply:
 * `plan -detailed-exitcode -out=tfplan`, inspect the plan JSON, and
 *   - delete/replace actions  → always abort (never overridable),
 *   - update actions          → abort unless --allow-changes,
 *   - create-only plans       → apply,
 *   - zero-change plans       → no-op ("found").
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Twin dependency chain, per the etl repo's remote-state graph
 * (etl-platform/infrastructure/README.md): aurora emits subnets/SGs read by
 * dagster and neptune; dagster's task SG is looked up by name from the
 * neptune stack, so dagster must precede neptune. data-lake/landing/
 * query-router are read by dagster. CI applies alphabetically and relies on
 * pre-existing state; we enforce the order explicitly.
 */
export const TWIN_STACK_ORDER = [
  "aurora",
  "data-lake",
  "landing",
  "query-router",
  "dagster",
  "observability",
  "trigger-dispatcher",
  "neptune",
] as const;

export interface EtlExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type EtlExec = (
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; stream?: boolean },
) => EtlExecResult;

export function defaultEtlExec(
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; stream?: boolean },
): EtlExecResult {
  const proc = spawnSync("terraform", args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    stdio: opts.stream
      ? ["inherit", "inherit", "inherit"]
      : ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

// ── Layout resolution ────────────────────────────────────────────────────────

export interface EtlLayout {
  stacksDir: string;
  backendHcl: string;
  tfvars: string;
  /** Stack names the account opts out of (accounts/<slug>.skip-stacks). */
  skipStacks: string[];
  /** Twin-order stacks that exist for this account (skip-stacks removed). */
  stacks: string[];
}

export interface EtlLayoutProbe {
  layout: EtlLayout | null;
  /** Human-readable problems, each naming the missing piece. */
  problems: string[];
}

export function resolveEtlLayout(
  etlRepoDir: string,
  accountSlug: string,
): EtlLayoutProbe {
  const infraDir = join(etlRepoDir, "etl-platform", "infrastructure");
  const stacksDir = join(infraDir, "stacks");
  const accountsDir = join(infraDir, "accounts");
  const backendHcl = join(accountsDir, `${accountSlug}.backend.hcl`);
  const tfvars = join(accountsDir, `${accountSlug}.tfvars`);
  const skipFile = join(accountsDir, `${accountSlug}.skip-stacks`);

  const problems: string[] = [];
  if (!existsSync(stacksDir)) {
    problems.push(`stacks dir missing: ${stacksDir}`);
  }
  if (!existsSync(backendHcl)) {
    problems.push(
      `account backend config missing: ${backendHcl} — the etl repo has no ` +
        `"${accountSlug}" account. Onboard the account (accounts/${accountSlug}.{backend.hcl,tfvars} ` +
        `+ bootstrap) before installing.`,
    );
  }
  if (!existsSync(tfvars)) {
    problems.push(`account tfvars missing: ${tfvars}`);
  }

  let skipStacks: string[] = [];
  if (existsSync(skipFile)) {
    skipStacks = readFileSync(skipFile, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  const stacks: string[] = [];
  if (existsSync(stacksDir)) {
    for (const name of TWIN_STACK_ORDER) {
      if (skipStacks.includes(name)) continue;
      if (!existsSync(join(stacksDir, name))) {
        problems.push(
          `expected twin stack dir missing from etl repo: ${join(stacksDir, name)}`,
        );
        continue;
      }
      stacks.push(name);
    }
  }

  if (problems.length > 0) return { layout: null, problems };
  return {
    layout: { stacksDir, backendHcl, tfvars, skipStacks, stacks },
    problems: [],
  };
}

// ── Argument construction (pure, unit-tested) ────────────────────────────────

export function buildInitArgs(stackDir: string, backendHcl: string): string[] {
  return [
    `-chdir=${stackDir}`,
    "init",
    "-input=false",
    "-reconfigure",
    `-backend-config=${backendHcl}`,
  ];
}

export function buildPlanArgs(
  stackDir: string,
  tfvars: string,
  planOut: string,
): string[] {
  return [
    `-chdir=${stackDir}`,
    "plan",
    "-input=false",
    "-detailed-exitcode",
    `-var-file=${tfvars}`,
    `-out=${planOut}`,
  ];
}

export function buildShowArgs(stackDir: string, planOut: string): string[] {
  return [`-chdir=${stackDir}`, "show", "-json", planOut];
}

export function buildApplyArgs(stackDir: string, planOut: string): string[] {
  return [`-chdir=${stackDir}`, "apply", "-input=false", planOut];
}

export function buildOutputArgs(stackDir: string): string[] {
  return [`-chdir=${stackDir}`, "output", "-json"];
}

/**
 * Per-account TF_DATA_DIR, mirroring the etl repo's own tf.sh convention so
 * our init -reconfigure never clobbers a differently-backed .terraform dir.
 */
export function etlDataDirEnv(
  stackDir: string,
  accountSlug: string,
): Record<string, string> {
  return { TF_DATA_DIR: join(stackDir, `.terraform-${accountSlug}`) };
}

// ── Plan-gate classification (R4) ────────────────────────────────────────────

export interface PlanActionSummary {
  creates: string[];
  updates: string[];
  deletes: string[];
  replaces: string[];
}

export function classifyPlanActions(showJson: string): PlanActionSummary {
  const summary: PlanActionSummary = {
    creates: [],
    updates: [],
    deletes: [],
    replaces: [],
  };
  const parsed = JSON.parse(showJson) as {
    resource_changes?: Array<{
      address: string;
      change: { actions: string[] };
    }>;
  };
  for (const rc of parsed.resource_changes ?? []) {
    const actions = rc.change.actions;
    if (actions.includes("create") && actions.includes("delete")) {
      summary.replaces.push(rc.address);
    } else if (actions.includes("delete")) {
      summary.deletes.push(rc.address);
    } else if (actions.includes("update")) {
      summary.updates.push(rc.address);
    } else if (actions.includes("create")) {
      summary.creates.push(rc.address);
    }
    // no-op / read → ignored
  }
  return summary;
}

export type PlanGateVerdict =
  | { kind: "no-op" }
  | { kind: "apply"; summary: PlanActionSummary }
  | { kind: "abort"; reason: string; summary: PlanActionSummary };

/**
 * R4 gate: delete/replace never applies from this command; updates need the
 * explicit --allow-changes acknowledgment; pure creates apply.
 */
export function gatePlan(
  summary: PlanActionSummary,
  allowChanges: boolean,
): PlanGateVerdict {
  const destructive = [...summary.deletes, ...summary.replaces];
  if (destructive.length > 0) {
    return {
      kind: "abort",
      reason:
        `plan contains destructive actions (${destructive.slice(0, 5).join(", ")}` +
        `${destructive.length > 5 ? ", …" : ""}) — this command never destroys or ` +
        "replaces twin resources (R4). Resolve manually via the etl repo.",
      summary,
    };
  }
  if (summary.updates.length > 0 && !allowChanges) {
    return {
      kind: "abort",
      reason:
        `plan modifies existing resources (${summary.updates.slice(0, 5).join(", ")}` +
        `${summary.updates.length > 5 ? ", …" : ""}) — pass --allow-changes to apply ` +
        "modifications to already-existing stacks.",
      summary,
    };
  }
  if (summary.creates.length === 0 && summary.updates.length === 0) {
    return { kind: "no-op" };
  }
  return { kind: "apply", summary };
}

// ── Output capture ───────────────────────────────────────────────────────────

export interface NeptuneOutputs {
  neptuneEndpoint: string;
  clusterResourceId: string;
  clientSgId: string;
  /** Bulk-loader staging bucket (THINK-331 bulk-rebuild lane). */
  loadBucket: string;
  /** Neptune loader IAM role (THINK-331 bulk-rebuild lane). */
  loaderRoleArn: string;
}

/** Output names as declared by the etl repo's neptune stack. */
const NEPTUNE_OUTPUT_KEYS = {
  neptuneEndpoint: "cluster_endpoint",
  clusterResourceId: "cluster_resource_id",
  clientSgId: "client_sg_id",
  loadBucket: "bulk_load_bucket_name",
  loaderRoleArn: "loader_role_arn",
} as const;

export function parseNeptuneOutputs(outputJson: string): {
  outputs: NeptuneOutputs | null;
  missing: string[];
} {
  const parsed = JSON.parse(outputJson) as Record<string, { value?: unknown }>;
  const missing: string[] = [];
  const read = (key: string): string => {
    const v = parsed[key]?.value;
    if (typeof v !== "string" || v.length === 0) {
      missing.push(key);
      return "";
    }
    return v;
  };
  const outputs: NeptuneOutputs = {
    neptuneEndpoint: read(NEPTUNE_OUTPUT_KEYS.neptuneEndpoint),
    clusterResourceId: read(NEPTUNE_OUTPUT_KEYS.clusterResourceId),
    clientSgId: read(NEPTUNE_OUTPUT_KEYS.clientSgId),
    loadBucket: read(NEPTUNE_OUTPUT_KEYS.loadBucket),
    loaderRoleArn: read(NEPTUNE_OUTPUT_KEYS.loaderRoleArn),
  };
  if (missing.length > 0) return { outputs: null, missing };
  return { outputs, missing: [] };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface StackRunEntry {
  stack: string;
  state: "found" | "created" | "changed" | "failed" | "planned";
  detail: string;
}

export interface EtlRunResult {
  entries: StackRunEntry[];
  /** Stacks never attempted because an earlier one failed. */
  notAttempted: string[];
  /** Captured only when the neptune stack completed (or was found). */
  neptuneOutputs: NeptuneOutputs | null;
  failed: boolean;
}

export interface EtlRunOptions {
  etlRepoDir: string;
  accountSlug: string;
  dryRun: boolean;
  allowChanges: boolean;
  exec?: EtlExec;
  log?: (line: string) => void;
}

export function runEtlTwinStacks(opts: EtlRunOptions): EtlRunResult {
  const exec = opts.exec ?? defaultEtlExec;
  const log = opts.log ?? (() => {});
  const result: EtlRunResult = {
    entries: [],
    notAttempted: [],
    neptuneOutputs: null,
    failed: false,
  };

  const probe = resolveEtlLayout(opts.etlRepoDir, opts.accountSlug);
  if (!probe.layout) {
    result.failed = true;
    result.entries.push({
      stack: "etl layout",
      state: "failed",
      detail: probe.problems.join("; "),
    });
    result.notAttempted.push(...TWIN_STACK_ORDER);
    return result;
  }
  const { stacksDir, backendHcl, tfvars, stacks } = probe.layout;

  for (let i = 0; i < stacks.length; i++) {
    const stack = stacks[i];
    const stackDir = join(stacksDir, stack);
    const env = etlDataDirEnv(stackDir, opts.accountSlug);
    const planOut = join(env.TF_DATA_DIR, "twin-install.tfplan");
    const fail = (detail: string) => {
      result.entries.push({ stack, state: "failed", detail });
      result.notAttempted.push(...stacks.slice(i + 1));
      result.failed = true;
    };

    log(`etl stack ${stack}: init`);
    const init = exec(buildInitArgs(stackDir, backendHcl), {
      cwd: stackDir,
      env,
    });
    if (init.status !== 0) {
      fail(`terraform init failed: ${lastLines(init.stderr || init.stdout)}`);
      return result;
    }

    log(`etl stack ${stack}: plan`);
    const plan = exec(buildPlanArgs(stackDir, tfvars, planOut), {
      cwd: stackDir,
      env,
    });
    if (plan.status === 0) {
      result.entries.push({
        stack,
        state: "found",
        detail: "no changes (state already carries the resources)",
      });
    } else if (plan.status === 2) {
      const show = exec(buildShowArgs(stackDir, planOut), {
        cwd: stackDir,
        env,
      });
      if (show.status !== 0) {
        fail(`terraform show failed: ${lastLines(show.stderr || show.stdout)}`);
        return result;
      }
      let verdict: PlanGateVerdict;
      try {
        verdict = gatePlan(classifyPlanActions(show.stdout), opts.allowChanges);
      } catch (err) {
        fail(`could not parse plan JSON: ${String(err)}`);
        return result;
      }
      if (verdict.kind === "abort") {
        fail(verdict.reason);
        return result;
      }
      if (verdict.kind === "no-op") {
        result.entries.push({ stack, state: "found", detail: "no changes" });
      } else if (opts.dryRun) {
        result.entries.push({
          stack,
          state: "planned",
          detail: describeSummary(verdict.summary) + " (dry-run: not applied)",
        });
      } else {
        log(`etl stack ${stack}: apply (${describeSummary(verdict.summary)})`);
        const apply = exec(buildApplyArgs(stackDir, planOut), {
          cwd: stackDir,
          env,
          stream: true,
        });
        if (apply.status !== 0) {
          fail(
            `terraform apply failed: ${lastLines(apply.stderr || apply.stdout)}`,
          );
          return result;
        }
        result.entries.push({
          stack,
          state: verdict.summary.updates.length > 0 ? "changed" : "created",
          detail: describeSummary(verdict.summary),
        });
      }
    } else {
      fail(`terraform plan failed: ${lastLines(plan.stderr || plan.stdout)}`);
      return result;
    }

    if (stack === "neptune") {
      // On a dry-run against an uninstalled account there is no state to
      // read — leave outputs null instead of failing.
      const out = exec(buildOutputArgs(stackDir), { cwd: stackDir, env });
      if (out.status !== 0) {
        if (!opts.dryRun) {
          fail(
            `terraform output failed: ${lastLines(out.stderr || out.stdout)}`,
          );
          return result;
        }
        continue;
      }
      let parsedOut: ReturnType<typeof parseNeptuneOutputs>;
      try {
        parsedOut = parseNeptuneOutputs(out.stdout);
      } catch (err) {
        if (!opts.dryRun) {
          fail(`could not parse terraform outputs: ${String(err)}`);
          return result;
        }
        continue;
      }
      if (!parsedOut.outputs) {
        if (!opts.dryRun) {
          fail(
            `neptune stack outputs missing: ${parsedOut.missing.join(", ")} — ` +
              "the stack applied but did not emit the values the product deploy needs.",
          );
          return result;
        }
        continue;
      }
      result.neptuneOutputs = parsedOut.outputs;
    }
  }

  return result;
}

function describeSummary(s: PlanActionSummary): string {
  const parts: string[] = [];
  if (s.creates.length) parts.push(`${s.creates.length} to create`);
  if (s.updates.length) parts.push(`${s.updates.length} to update`);
  return parts.join(", ") || "no actions";
}

function lastLines(text: string, n = 3): string {
  return text.trim().split("\n").slice(-n).join(" | ").slice(0, 400);
}
