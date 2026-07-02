import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Check,
  APPLY_ESTIMATE_MINUTES,
  evaluateAgentcorePiImageProbe,
  evaluateBackendProbe,
  evaluateCredentialExpiry,
  evaluateDomainDelegation,
  evaluateSesStatus,
  checkDomainDelegation,
  checkSesStatus,
  checkStateBackend,
  parseEcrImageUri,
  preflightChecks,
  runChecks,
} from "../src/lib/checks.js";
import { backendTarget } from "../src/lib/state-backend.js";
import { readTfvarsSignals } from "../src/commands/deploy.js";

const TARGET = backendTarget("123456789012", "us-east-1", "prod");

describe("runChecks", () => {
  it("runs every check and reports all blockers at once (no short-circuit)", async () => {
    const ran: string[] = [];
    const make = (name: string, pass: boolean, blocking?: boolean): Check => ({
      name,
      blocking,
      run: () => {
        ran.push(name);
        return { pass, detail: name };
      },
    });
    const summary = await runChecks([
      make("a", false),
      make("b", true),
      make("c", false),
      make("ses", false, false),
    ]);
    expect(ran).toEqual(["a", "b", "c", "ses"]);
    expect(summary.passed).toBe(false);
    expect(summary.failures.map((f) => f.name)).toEqual(["a", "c"]);
    // Warn-tier failure never blocks (AE3) — it lands in warnings.
    expect(summary.warnings.map((w) => w.name)).toEqual(["ses"]);
  });

  it("passes with warnings when only warn-tier checks fail", async () => {
    const summary = await runChecks([
      { name: "ok", run: () => ({ pass: true, detail: "" }) },
      {
        name: "ses",
        blocking: false,
        run: () => ({ pass: false, detail: "sandbox" }),
      },
    ]);
    expect(summary.passed).toBe(true);
    expect(summary.warnings).toHaveLength(1);
  });
});

describe("credential expiry margin", () => {
  const now = new Date("2026-07-01T12:00:00Z");

  it("passes for long-lived credentials (no expiration)", () => {
    expect(evaluateCredentialExpiry(null, now).pass).toBe(true);
  });

  it("fails when the token expires before a full apply could finish", () => {
    const soon = new Date(now.getTime() + 10 * 60000).toISOString();
    const result = evaluateCredentialExpiry(soon, now);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("10 min");
    expect(result.detail).toContain(`${APPLY_ESTIMATE_MINUTES} min`);
  });

  it("passes with comfortable margin", () => {
    const later = new Date(now.getTime() + 120 * 60000).toISOString();
    expect(evaluateCredentialExpiry(later, now).pass).toBe(true);
  });
});

describe("state backend probe", () => {
  it("passes for existing and missing (will-create) buckets, fails on denied", () => {
    expect(evaluateBackendProbe("exists", TARGET).pass).toBe(true);
    expect(evaluateBackendProbe("missing", TARGET).pass).toBe(true);
    expect(evaluateBackendProbe("denied", TARGET).pass).toBe(false);
  });

  it("classifies AccessDenied stderr as denied", async () => {
    const check = checkStateBackend(TARGET, () => ({
      status: 254,
      stdout: "",
      stderr: "An error occurred (403) AccessDenied when calling HeadBucket",
    }));
    const result = await check.run();
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("No access to state bucket");
  });
});

describe("domain delegation", () => {
  it("fails with delegation instructions when NS resolution fails", async () => {
    const check = checkDomainDelegation("nope.example", () =>
      Promise.reject(new Error("ENOTFOUND")),
    );
    const result = await check.run();
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("no resolvable NS records");
    expect(result.detail).toContain("Delegate the domain");
  });

  it("passes and lists nameservers on success", async () => {
    const check = checkDomainDelegation("customer.com", () =>
      Promise.resolve(["ns1.aws.com", "ns2.aws.com", "ns3.aws.com"]),
    );
    const result = await check.run();
    expect(result.pass).toBe(true);
    expect(result.detail).toContain("ns1.aws.com");
  });

  it("treats an empty NS set as undelegated", () => {
    expect(evaluateDomainDelegation("x.com", []).pass).toBe(false);
  });
});

describe("SES status (warn-tier)", () => {
  it("is a non-blocking check that reports sandbox state", async () => {
    const check = checkSesStatus(() => ({
      status: 0,
      stdout: "False\n",
      stderr: "",
    }));
    expect(check.blocking).toBe(false);
    const result = await check.run();
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("sandbox");
    expect(result.detail).toContain("deploy proceeds");
  });

  it("passes on production access and skips when unreadable", () => {
    expect(evaluateSesStatus(true).pass).toBe(true);
    expect(evaluateSesStatus(null).pass).toBe(true);
  });
});

describe("readTfvarsSignals", () => {
  it("detects domain and SES config from uncommented assignments only", () => {
    const dir = mkdtempSync(join(tmpdir(), "tfvars-signals-"));
    writeFileSync(
      join(dir, "terraform.tfvars"),
      [
        'stage = "prod"',
        'customer_domain = "acme.example.com"',
        '# ses_parent_domain = "commented-out.example"',
        'cognito_email_source_arn = "arn:aws:ses:us-east-1:1:identity/x"',
      ].join("\n"),
    );
    const signals = readTfvarsSignals(dir);
    expect(signals.domain).toBe("acme.example.com");
    expect(signals.sesConfigured).toBe(true);
  });

  it("returns no signals for a missing tfvars or empty values", () => {
    const dir = mkdtempSync(join(tmpdir(), "tfvars-signals-"));
    expect(readTfvarsSignals(dir)).toEqual({
      sesConfigured: false,
      domainDelegated: false,
    });
    writeFileSync(
      join(dir, "terraform.tfvars"),
      ['customer_domain = ""', 'ses_parent_domain = ""'].join("\n"),
    );
    const signals = readTfvarsSignals(dir);
    expect(signals.domain).toBeUndefined();
    expect(signals.sesConfigured).toBe(false);
  });
});

describe("AgentCore Pi source image probe", () => {
  it("parses ECR image URIs", () => {
    expect(
      parseEcrImageUri(
        "424337058806.dkr.ecr.us-east-1.amazonaws.com/thinkwork-hci-agentcore:pi-latest",
      ),
    ).toEqual({
      registry: "424337058806.dkr.ecr.us-east-1.amazonaws.com",
      region: "us-east-1",
    });
    expect(
      parseEcrImageUri("ghcr.io/thinkwork-ai/thinkwork-agentcore@sha256:abc"),
    ).toBeNull();
  });

  it("passes without docker (the apply-time seed is the authority)", () => {
    const result = evaluateAgentcorePiImageProbe({
      uri: "ghcr.io/x/y:z",
      dockerAvailable: false,
      reachable: false,
    });
    expect(result.pass).toBe(true);
  });

  it("passes when the manifest is reachable", () => {
    const result = evaluateAgentcorePiImageProbe({
      uri: "ghcr.io/x/y:z",
      dockerAvailable: true,
      reachable: true,
    });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain("ghcr.io/x/y:z");
  });

  it("fails with remediation when the image is unreachable", () => {
    const result = evaluateAgentcorePiImageProbe({
      uri: "ghcr.io/x/y:z",
      dockerAvailable: true,
      reachable: false,
      error: "unexpected status from HEAD request: 403 Forbidden\nmore",
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("403 Forbidden");
    expect(result.detail).toContain("agentcore_pi_source_image_uri");
  });

  it("joins preflight only when a source image is pinned", () => {
    const withImage = preflightChecks({
      agentcorePiSourceImage: "ghcr.io/x/y:z",
    });
    expect(withImage.some((c) => c.name === "AgentCore image pullable")).toBe(
      true,
    );
    const without = preflightChecks({});
    expect(without.some((c) => c.name === "AgentCore image pullable")).toBe(
      false,
    );
  });
});

describe("domain delegation gating (harness HCI test)", () => {
  it("is warn-tier until customer_domain_delegated flips true", async () => {
    const undelegated = checkDomainDelegation(
      "hci.thinkwork.ai",
      async () => [],
      false,
    );
    expect(undelegated.blocking).toBe(false);
    const delegated = checkDomainDelegation(
      "hci.thinkwork.ai",
      async () => [],
      true,
    );
    expect(delegated.blocking).toBe(true);
  });

  it("reads customer_domain_delegated from tfvars", () => {
    const dir = mkdtempSync(join(tmpdir(), "tfvars-delegated-"));
    writeFileSync(
      join(dir, "terraform.tfvars"),
      ['customer_domain = "hci.thinkwork.ai"', "customer_domain_delegated = true"].join("\n"),
    );
    const signals = readTfvarsSignals(dir);
    expect(signals.domain).toBe("hci.thinkwork.ai");
    expect(signals.domainDelegated).toBe(true);
  });
});
