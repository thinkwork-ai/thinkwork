/**
 * Shared account/environment Check registry (KTD-4).
 *
 * `thinkwork doctor` and `thinkwork deploy`'s preflight both run these. Each
 * check is a name + run() returning {pass, detail}; run() may be async.
 * `blocking: false` marks warn-tier checks that are reported but never stop a
 * deploy (e.g. SES production access — a pending external approval counts as
 * success-with-checklist per AE3, not a blocker).
 *
 * New checks join this registry as THINK-118 harness ledger entries prove a
 * failure class preflightable (R10 feedback loop).
 */

import { execSync } from "node:child_process";
import { resolveNs } from "node:dns/promises";
import { getAwsIdentity } from "../aws.js";
import { type BackendTarget, type ExecResult } from "./state-backend.js";
import { spawnSync } from "node:child_process";

export interface CheckResult {
  pass: boolean;
  detail: string;
}

export interface Check {
  name: string;
  /** false → warn-tier: reported, never blocks. Default true. */
  blocking?: boolean;
  run: () => CheckResult | Promise<CheckResult>;
}

function awsExec(args: string[]): ExecResult {
  const proc = spawnSync("aws", args, { encoding: "utf8" });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

// ── Tooling / identity ────────────────────────────────────────────────────────

export function checkAwsCli(): Check {
  return {
    name: "AWS CLI installed",
    run: () => {
      try {
        const v = execSync("aws --version", {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return { pass: true, detail: v.split(" ")[0] ?? v };
      } catch {
        return {
          pass: false,
          detail: "aws CLI not found. Install: https://aws.amazon.com/cli/",
        };
      }
    },
  };
}

export function checkTerraformCli(): Check {
  return {
    name: "Terraform CLI installed",
    run: () => {
      try {
        const v = execSync("terraform version -json", {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const parsed = JSON.parse(v) as { terraform_version: string };
        return { pass: true, detail: `v${parsed.terraform_version}` };
      } catch {
        return {
          pass: false,
          detail:
            "terraform CLI not found. Install: https://developer.hashicorp.com/terraform/install",
        };
      }
    },
  };
}

export function checkAwsIdentity(): Check {
  return {
    name: "AWS credentials configured",
    run: () => {
      const identity = getAwsIdentity();
      if (identity) {
        return {
          pass: true,
          detail: `account=${identity.account} region=${identity.region}`,
        };
      }
      return {
        pass: false,
        detail:
          "Could not resolve AWS identity. Run `aws configure` or set AWS_PROFILE.",
      };
    },
  };
}

// ── Bedrock ───────────────────────────────────────────────────────────────────

export const DOCTOR_BEDROCK_PROBE_MODEL_ID =
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * Interpret a Bedrock converse probe outcome. An entitlement listing is not
 * enough: the McPherson install (2026-06-12) green-checked an account whose
 * effective inference allowance was zero (new-account dynamic quota ramp) and
 * whose Anthropic use-case form was unsubmitted — both only visible by
 * actually invoking a model.
 */
export function evaluateBedrockProbe(error: string | null): CheckResult {
  if (error === null) {
    return {
      pass: true,
      detail: `${DOCTOR_BEDROCK_PROBE_MODEL_ID} invocation OK`,
    };
  }
  if (error.includes("use case details")) {
    return {
      pass: false,
      detail:
        "Anthropic use-case form not submitted for this account. Submit it via " +
        "`aws bedrock put-use-case-for-model-access` or the Bedrock console " +
        "(Model access); it processes in ~15 minutes.",
    };
  }
  if (error.includes("ThrottlingException")) {
    return {
      pass: false,
      detail:
        "Bedrock throttled the probe — new AWS accounts start with an effective " +
        "inference allowance of ~zero (per region) that ramps up with account " +
        "age/billing history over hours-to-days. The applied Service Quotas " +
        "values are not the enforced values; nothing is configurable here.",
    };
  }
  if (error.includes("AccessDeniedException")) {
    return {
      pass: false,
      detail:
        "Bedrock model access denied. Request model access in the AWS console " +
        "(Bedrock → Model access) for the Anthropic models.",
    };
  }
  return {
    pass: false,
    detail: `Bedrock invocation failed: ${error.slice(0, 200)}`,
  };
}

export function checkBedrockAccess(): Check {
  return {
    name: "Bedrock model invocation",
    run: () => {
      const region = process.env.AWS_REGION || "us-east-1";
      try {
        execSync(
          `aws bedrock-runtime converse --model-id ${DOCTOR_BEDROCK_PROBE_MODEL_ID} ` +
            `--messages '[{"role":"user","content":[{"text":"Reply with OK"}]}]' ` +
            `--inference-config '{"maxTokens":1}' --output json --region ${region}`,
          {
            encoding: "utf-8",
            timeout: 30000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        return evaluateBedrockProbe(null);
      } catch (err) {
        const stderr =
          err instanceof Error && "stderr" in err
            ? String((err as { stderr?: unknown }).stderr ?? err.message)
            : String(err);
        return evaluateBedrockProbe(stderr);
      }
    },
  };
}

// ── Lambda concurrency quota ─────────────────────────────────────────────────

/**
 * New AWS accounts default to 10 concurrent Lambda executions — too low for
 * the stack's reserved-concurrency handlers (the apply fails on
 * PutFunctionConcurrency) and for production traffic generally.
 */
export const MIN_LAMBDA_CONCURRENT_EXECUTIONS = 100;

export function evaluateLambdaConcurrency(value: number | null): CheckResult {
  if (value === null) {
    return {
      pass: false,
      detail: "Could not read the account's Lambda concurrency limit.",
    };
  }
  if (value < MIN_LAMBDA_CONCURRENT_EXECUTIONS) {
    return {
      pass: false,
      detail:
        `Account Lambda concurrency limit is ${value} (new-account default is 10); ` +
        `the deploy fails on reserved-concurrency handlers below ` +
        `${MIN_LAMBDA_CONCURRENT_EXECUTIONS}. Request an increase: ` +
        "`aws service-quotas request-service-quota-increase --service-code lambda " +
        "--quota-code L-B99A9384 --desired-value 1000`.",
    };
  }
  return { pass: true, detail: `concurrent executions limit ${value}` };
}

export function checkLambdaConcurrency(): Check {
  return {
    name: "Lambda concurrency quota",
    run: () => {
      const region = process.env.AWS_REGION || "us-east-1";
      try {
        const raw = execSync(
          `aws lambda get-account-settings --query AccountLimit.ConcurrentExecutions --output text --region ${region}`,
          {
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ).trim();
        const value = Number.parseInt(raw, 10);
        return evaluateLambdaConcurrency(Number.isNaN(value) ? null : value);
      } catch {
        return evaluateLambdaConcurrency(null);
      }
    },
  };
}

// ── Credential expiry margin ──────────────────────────────────────────────────

/** Conservative full-stack apply estimate for the expiry margin. */
export const APPLY_ESTIMATE_MINUTES = 45;

/**
 * Temporary credentials (SSO/STS) that expire mid-apply strand state mid-write.
 * Long-lived keys report no expiration and pass.
 */
export function evaluateCredentialExpiry(
  expiration: string | null,
  now: Date,
  requiredMinutes: number = APPLY_ESTIMATE_MINUTES,
): CheckResult {
  if (!expiration) {
    return { pass: true, detail: "long-lived credentials (no expiration)" };
  }
  const expires = new Date(expiration);
  if (Number.isNaN(expires.getTime())) {
    return { pass: true, detail: `unparseable expiration "${expiration}"` };
  }
  const minutesLeft = Math.floor((expires.getTime() - now.getTime()) / 60000);
  if (minutesLeft < requiredMinutes) {
    return {
      pass: false,
      detail:
        `Credentials expire in ${minutesLeft} min — a full apply can take ~${requiredMinutes} min ` +
        `and an expiry mid-apply strands state mid-write. Refresh first ` +
        "(`aws sso login` or re-assume the role), then rerun.",
    };
  }
  return { pass: true, detail: `credentials valid for ${minutesLeft} min` };
}

export function checkCredentialExpiry(): Check {
  return {
    name: "Credential expiry margin",
    run: () => {
      try {
        const raw = execSync(
          "aws configure export-credentials --format process",
          {
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        const parsed = JSON.parse(raw) as { Expiration?: string };
        return evaluateCredentialExpiry(parsed.Expiration ?? null, new Date());
      } catch {
        // export-credentials unsupported for this credential source — treat as
        // long-lived rather than blocking on an unreadable signal.
        return evaluateCredentialExpiry(null, new Date());
      }
    },
  };
}

// ── State backend reachability (U2) ──────────────────────────────────────────

export function evaluateBackendProbe(
  bucketStatus: "exists" | "missing" | "denied",
  target: BackendTarget,
): CheckResult {
  switch (bucketStatus) {
    case "exists":
      return { pass: true, detail: `s3://${target.bucket} reachable` };
    case "missing":
      return {
        pass: true,
        detail: `s3://${target.bucket} will be created before apply`,
      };
    case "denied":
      return {
        pass: false,
        detail:
          `No access to state bucket s3://${target.bucket} — the caller needs ` +
          "s3:CreateBucket/GetObject/PutObject and dynamodb table rights for the state backend.",
      };
  }
}

export function checkStateBackend(
  target: BackendTarget,
  exec: (args: string[]) => ExecResult = awsExec,
): Check {
  return {
    name: "Terraform state backend",
    run: () => {
      const head = exec(["s3api", "head-bucket", "--bucket", target.bucket]);
      if (head.status === 0) return evaluateBackendProbe("exists", target);
      if (/403|AccessDenied|Forbidden/i.test(head.stderr)) {
        return evaluateBackendProbe("denied", target);
      }
      return evaluateBackendProbe("missing", target);
    },
  };
}

// ── Domain DNS delegation ─────────────────────────────────────────────────────

export function evaluateDomainDelegation(
  domain: string,
  nsRecords: string[] | null,
): CheckResult {
  if (!nsRecords || nsRecords.length === 0) {
    return {
      pass: false,
      detail:
        `Domain "${domain}" has no resolvable NS records — ACM certificate DNS ` +
        `validation would hang mid-apply (~45 min timeout), not fail. Delegate the ` +
        `domain at your registrar (or fix the hosted zone) before deploying.`,
    };
  }
  return {
    pass: true,
    detail: `NS: ${nsRecords.slice(0, 2).join(", ")}${nsRecords.length > 2 ? ", …" : ""}`,
  };
}

export function checkDomainDelegation(
  domain: string,
  resolver: (domain: string) => Promise<string[]> = resolveNs,
): Check {
  return {
    name: `Domain DNS delegation (${domain})`,
    run: async () => {
      try {
        const records = await resolver(domain);
        return evaluateDomainDelegation(domain, records);
      } catch {
        return evaluateDomainDelegation(domain, null);
      }
    },
  };
}

// ── SES production access (warn-tier — AE3) ──────────────────────────────────

export function evaluateSesStatus(
  productionAccess: boolean | null,
): CheckResult {
  if (productionAccess === true) {
    return { pass: true, detail: "SES production access enabled" };
  }
  if (productionAccess === false) {
    return {
      pass: false,
      detail:
        "SES is in sandbox — email delivery is limited to verified addresses until " +
        "AWS grants production access (manual approval, ~24h). The deploy proceeds; " +
        "`thinkwork status` tracks this as a pending external approval.",
    };
  }
  return { pass: true, detail: "SES status unreadable — skipping" };
}

export function checkSesStatus(
  exec: (args: string[]) => ExecResult = awsExec,
): Check {
  return {
    name: "SES production access",
    blocking: false,
    run: () => {
      const res = exec([
        "sesv2",
        "get-account",
        "--query",
        "ProductionAccessEnabled",
        "--output",
        "text",
      ]);
      if (res.status !== 0) return evaluateSesStatus(null);
      const text = res.stdout.trim().toLowerCase();
      return evaluateSesStatus(
        text === "true" ? true : text === "false" ? false : null,
      );
    },
  };
}

// ── Registry assembly + runner ────────────────────────────────────────────────

export function doctorChecks(): Check[] {
  return [
    checkAwsCli(),
    checkTerraformCli(),
    checkAwsIdentity(),
    checkBedrockAccess(),
    checkLambdaConcurrency(),
    checkCredentialExpiry(),
    // Warn-tier: pending SES production access is tracked here and in
    // `thinkwork verify`'s checklist (R9); it never blocks.
    checkSesStatus(),
  ];
}

export interface PreflightContext {
  backend?: BackendTarget;
  /** customer_domain from the stage tfvars, when configured */
  domain?: string;
  /** true when the stage tfvars configure SES */
  sesConfigured?: boolean;
}

export function preflightChecks(ctx: PreflightContext): Check[] {
  const checks = doctorChecks();
  if (ctx.backend) checks.push(checkStateBackend(ctx.backend));
  if (ctx.domain) checks.push(checkDomainDelegation(ctx.domain));
  if (ctx.sesConfigured) checks.push(checkSesStatus());
  return checks;
}

export interface RunChecksSummary {
  passed: boolean;
  failures: { name: string; detail: string }[];
  warnings: { name: string; detail: string }[];
  results: { name: string; blocking: boolean; result: CheckResult }[];
}

/** Run every check (never short-circuits) so all blockers report at once. */
export async function runChecks(checks: Check[]): Promise<RunChecksSummary> {
  const summary: RunChecksSummary = {
    passed: true,
    failures: [],
    warnings: [],
    results: [],
  };
  for (const check of checks) {
    const result = await check.run();
    const blocking = check.blocking !== false;
    summary.results.push({ name: check.name, blocking, result });
    if (!result.pass) {
      if (blocking) {
        summary.passed = false;
        summary.failures.push({ name: check.name, detail: result.detail });
      } else {
        summary.warnings.push({ name: check.name, detail: result.detail });
      }
    }
  }
  return summary;
}
