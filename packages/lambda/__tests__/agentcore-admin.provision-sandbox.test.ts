/**
 * Unit tests for the pure helpers inside provisionTenantSandbox.
 *
 * The handler itself is not covered here — it calls IAM, AgentCore Control,
 * and Postgres, none of which have mock harnesses in this package yet. The
 * helpers below are the parts of the code that can drift on a misread plan
 * (role-name length ceiling, policy shape, tenant-id path substitution),
 * so they're the useful coverage right now.
 */

import { describe, it, expect } from "vitest";
import {
  computeRoleName,
  buildTrustPolicy,
  buildInlinePolicy,
} from "../agentcore-admin.js";

describe("computeRoleName", () => {
  it("strips UUID dashes and prepends the stage prefix", () => {
    const name = computeRoleName("dev", "11111111-2222-3333-4444-555555555555");
    expect(name).toBe(
      "thinkwork-dev-sandbox-tenant-11111111222233334444555555555555",
    );
  });

  it("stays inside the 64-char IAM limit for realistic stage names", () => {
    for (const stage of ["dev", "prod", "staging", "integration"]) {
      const name = computeRoleName(
        stage,
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      );
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name.startsWith(`thinkwork-${stage}-sandbox-tenant-`)).toBe(true);
    }
  });

  it("truncates rather than overflowing when a stage name is unexpectedly long", () => {
    // Defense-in-depth; no production stage hits this, but we don't want to
    // generate an IAM-reject name if someone tries.
    const name = computeRoleName(
      "x".repeat(40),
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(name.length).toBe(64);
  });
});

describe("buildTrustPolicy", () => {
  it("constrains the principal to bedrock-agentcore with SourceAccount", () => {
    const policy = buildTrustPolicy("123456789012") as any;
    expect(policy.Version).toBe("2012-10-17");
    expect(policy.Statement).toHaveLength(1);
    expect(policy.Statement[0].Principal.Service).toBe(
      "bedrock-agentcore.amazonaws.com",
    );
    expect(policy.Statement[0].Action).toBe("sts:AssumeRole");
    expect(
      policy.Statement[0].Condition.StringEquals["aws:SourceAccount"],
    ).toBe("123456789012");
  });
});

describe("buildInlinePolicy", () => {
  it("scopes Secrets Manager reads to the tenant's sandbox path", () => {
    const policy = buildInlinePolicy(
      "dev",
      "abc-tenant-id-123",
      "us-east-1",
      "123456789012",
    ) as any;
    const sm = policy.Statement.find(
      (s: any) => s.Sid === "SandboxSecretsRead",
    );
    expect(sm).toBeDefined();
    expect(sm.Resource).toBe(
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:thinkwork/dev/sandbox/abc-tenant-id-123/*",
    );
    expect(sm.Action).toContain("secretsmanager:GetSecretValue");
  });

  it("grants CloudWatch write only under the AgentCore runtime path", () => {
    const policy = buildInlinePolicy(
      "dev",
      "abc",
      "us-east-1",
      "123456789012",
    ) as any;
    const logs = policy.Statement.find(
      (s: any) => s.Sid === "SandboxCloudWatchLogs",
    );
    expect(logs).toBeDefined();
    expect(logs.Resource).toBe(
      "arn:aws:logs:us-east-1:123456789012:log-group:/aws/bedrock-agentcore/runtimes/*",
    );
    expect(logs.Action).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
  });

  it("substitutes a different tenant id per call", () => {
    const a = buildInlinePolicy("dev", "tenant-a", "us-east-1", "111") as any;
    const b = buildInlinePolicy("dev", "tenant-b", "us-east-1", "111") as any;
    const aSm = a.Statement.find((s: any) => s.Sid === "SandboxSecretsRead");
    const bSm = b.Statement.find((s: any) => s.Sid === "SandboxSecretsRead");
    expect(aSm.Resource).toContain("/tenant-a/*");
    expect(bSm.Resource).toContain("/tenant-b/*");
    expect(aSm.Resource).not.toContain("/tenant-b/");
  });
});
