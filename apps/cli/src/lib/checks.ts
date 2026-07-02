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
 * Fallback probe model: per-model inference quotas are independent, so a
 * throttle on the primary says "that model is busy here", not "no Bedrock
 * access" — dev's steady Haiku traffic starved three graduation preflights.
 */
export const DOCTOR_BEDROCK_FALLBACK_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

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
    run: async () => {
      const region = process.env.AWS_REGION || "us-east-1";
      // Busy accounts (dev + harness sharing quota) throw transient
      // ThrottlingExceptions that are NOT deploy blockers — retry with
      // backoff before treating throttle as a verdict (prod graduation was
      // blocked twice by one-shot probes). Persistent throttle still fails.
      let lastError: string | null = null;
      const models = [
        DOCTOR_BEDROCK_PROBE_MODEL_ID,
        DOCTOR_BEDROCK_PROBE_MODEL_ID,
        DOCTOR_BEDROCK_FALLBACK_MODEL_ID,
      ];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          execSync(
            `aws bedrock-runtime converse --model-id ${models[attempt - 1]} ` +
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
          lastError =
            err instanceof Error && "stderr" in err
              ? String((err as { stderr?: unknown }).stderr ?? err.message)
              : String(err);
          if (!lastError.includes("ThrottlingException") || attempt === 3) {
            return evaluateBedrockProbe(lastError);
          }
          await new Promise((r) => setTimeout(r, attempt * 5000));
        }
      }
      return evaluateBedrockProbe(lastError);
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
  delegated = true,
): Check {
  return {
    name: `Domain DNS delegation (${domain})`,
    // Delegation is DESIGNED to happen after the first deploy creates the
    // hosted zone (init says so verbatim). Until customer_domain_delegated
    // flips true, no ACM cert is minted — so unresolvable NS records are a
    // tracked pending item (R9/AE3), not a blocker. Blocking here made the
    // documented first-deploy flow impossible (HCI test, cycle 12).
    blocking: delegated,
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

// ── AgentCore Pi source image ─────────────────────────────────────────────────

/** Parse "<acct>.dkr.ecr.<region>.amazonaws.com/…" into its registry parts. */
export function parseEcrImageUri(
  uri: string,
): { registry: string; region: string } | null {
  const match = uri.match(/^(\d+\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com)\//);
  return match ? { registry: match[1], region: match[2] } : null;
}

export function evaluateAgentcorePiImageProbe(input: {
  uri: string;
  dockerAvailable: boolean;
  reachable: boolean;
  error?: string;
}): CheckResult {
  if (!input.dockerAvailable) {
    return {
      pass: true,
      detail:
        "docker unavailable — cannot probe the pinned image; the apply-time seed reports pull failures",
    };
  }
  if (input.reachable) {
    return { pass: true, detail: `${input.uri} reachable` };
  }
  const reason = (input.error ?? "").trim().split("\n")[0].slice(0, 160);
  return {
    pass: false,
    detail:
      `pinned AgentCore image ${input.uri} is not pullable from this machine` +
      (reason ? ` (${reason})` : "") +
      ". The apply keeps an already-seeded ECR image or builds from a repo checkout; " +
      "otherwise set agentcore_pi_source_image_uri in terraform.tfvars to a pullable image.",
  };
}

/**
 * Warn-tier probe of the pinned AgentCore Pi source image (harness ledger,
 * HCI validation 2026-07-02: a GHCR 403 surfaced ~7 minutes into terraform
 * apply). `docker manifest inspect` exercises the same registry auth a pull
 * would. Never blocks — the apply-time seed has fallbacks this probe cannot
 * see (already-seeded ECR target, repo-checkout build).
 */
export function checkAgentcorePiSourceImage(uri: string): Check {
  return {
    name: "AgentCore image pullable",
    blocking: false,
    run: () => {
      const docker = spawnSync("docker", ["--version"], { encoding: "utf8" });
      if (docker.status !== 0) {
        return evaluateAgentcorePiImageProbe({
          uri,
          dockerAvailable: false,
          reachable: false,
        });
      }
      // ECR sources need the same login the seed script performs.
      const ecr = parseEcrImageUri(uri);
      if (ecr) {
        spawnSync(
          "bash",
          [
            "-c",
            `aws ecr get-login-password --region ${ecr.region} | docker login --username AWS --password-stdin ${ecr.registry}`,
          ],
          { encoding: "utf8" },
        );
      }
      const probe = spawnSync("docker", ["manifest", "inspect", uri], {
        encoding: "utf8",
      });
      return evaluateAgentcorePiImageProbe({
        uri,
        dockerAvailable: true,
        reachable: probe.status === 0,
        error: probe.stderr,
      });
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
  /** customer_domain_delegated from the stage tfvars */
  domainDelegated?: boolean;
  /** true when the stage tfvars configure SES */
  sesConfigured?: boolean;
  /** agentcore_pi_source_image_uri from the stage tfvars, when pinned */
  agentcorePiSourceImage?: string;
}

export function preflightChecks(ctx: PreflightContext): Check[] {
  const checks = doctorChecks();
  if (ctx.backend) checks.push(checkStateBackend(ctx.backend));
  if (ctx.domain) {
    checks.push(
      checkDomainDelegation(ctx.domain, undefined, ctx.domainDelegated ?? true),
    );
  }
  if (ctx.sesConfigured) checks.push(checkSesStatus());
  if (ctx.agentcorePiSourceImage) {
    checks.push(checkAgentcorePiSourceImage(ctx.agentcorePiSourceImage));
  }
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
