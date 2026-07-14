/**
 * Unit tests for the pure helpers inside provisionTenantSandbox plus the
 * capability-private (THINK-280 U4) provisioning gate.
 *
 * The pure helpers (role-name length ceiling, policy shape, tenant-id path
 * substitution) are covered directly. The handler path is covered with the
 * IAM / AgentCore-Control / Postgres clients mocked at the module boundary
 * (mirroring job-trigger.canvas-refresh.test.ts) so we can assert:
 *   (a) the two-environment path is unchanged when the broker VPC env vars are
 *       absent — no third interpreter, no restricted role, column untouched;
 *   (b) capability-private is provisioned with a vpcConfig + a SEPARATE
 *       restricted role when the env vars are present;
 *   (c) the restricted role policy lacks Secrets Manager, S3, and DB access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock boundary -----------------------------------------------------------

const { iamCalls, aciCalls, dbUpdates } = vi.hoisted(() => ({
  iamCalls: [] as Array<{ name: string; input: any }>,
  aciCalls: [] as Array<{ name: string; input: any }>,
  dbUpdates: [] as Array<Record<string, unknown>>,
}));

class NoSuchEntityException extends Error {
  name = "NoSuchEntityException";
}

vi.mock("@aws-sdk/client-iam", () => {
  class Cmd {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  const send = vi.fn(async (cmd: any) => {
    const name = cmd.constructor.name;
    iamCalls.push({ name, input: cmd.input });
    switch (name) {
      case "GetRoleCommand":
        // Force the CreateRole path in the handler (role does not yet exist).
        throw new NoSuchEntityException("role not found");
      case "CreateRoleCommand":
        return {
          Role: {
            Arn: `arn:aws:iam::123456789012:role/${cmd.input.RoleName}`,
          },
        };
      case "PutRolePolicyCommand":
      case "DeleteRolePolicyCommand":
      case "DeleteRoleCommand":
        return {};
      default:
        return {};
    }
  });
  return {
    IAMClient: class {
      send = send;
    },
    CreateRoleCommand: class extends Cmd {},
    DeleteRoleCommand: class extends Cmd {},
    DeleteRolePolicyCommand: class extends Cmd {},
    GetRoleCommand: class extends Cmd {},
    PutRolePolicyCommand: class extends Cmd {},
  };
});

vi.mock("@aws-sdk/client-bedrock-agentcore-control", () => {
  class Cmd {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  const send = vi.fn(async (cmd: any) => {
    const name = cmd.constructor.name;
    aciCalls.push({ name, input: cmd.input });
    switch (name) {
      case "ListCodeInterpretersCommand":
        return { codeInterpreterSummaries: [], nextToken: undefined };
      case "CreateCodeInterpreterCommand":
        return { codeInterpreterId: `ci-${cmd.input.tags.Environment}` };
      case "DeleteCodeInterpreterCommand":
        return {};
      default:
        return {};
    }
  });
  return {
    BedrockAgentCoreControlClient: class {
      send = send;
    },
    CreateCodeInterpreterCommand: class extends Cmd {},
    DeleteCodeInterpreterCommand: class extends Cmd {},
    ListCodeInterpretersCommand: class extends Cmd {},
  };
});

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      update: () => ({
        set: (value: Record<string, unknown>) => {
          dbUpdates.push(value);
          return { where: () => Promise.resolve() };
        },
      }),
    }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenants: {
    id: "tenants.id",
    sandbox_interpreter_public_id: "tenants.sandbox_interpreter_public_id",
    sandbox_interpreter_internal_id: "tenants.sandbox_interpreter_internal_id",
    sandbox_interpreter_capability_private_id:
      "tenants.sandbox_interpreter_capability_private_id",
  },
}));

import {
  handler,
  computeRoleName,
  computeCapabilityPrivateRoleName,
  buildTrustPolicy,
  buildInlinePolicy,
  buildCapabilityPrivateInlinePolicy,
} from "../agentcore-admin.js";

const TOKEN = "test-admin-token";
const TENANT = "11111111-2222-3333-4444-555555555555";

function provisionEvent() {
  return {
    requestContext: {
      http: { method: "POST", path: "/provision-tenant-sandbox" },
    },
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tenant_id: TENANT }),
  };
}

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

describe("computeCapabilityPrivateRoleName", () => {
  it("uses a distinct prefix from the shared sandbox role", () => {
    const cap = computeCapabilityPrivateRoleName("dev", TENANT);
    const shared = computeRoleName("dev", TENANT);
    expect(cap).toBe(
      "thinkwork-dev-cappriv-tenant-11111111222233334444555555555555",
    );
    expect(cap).not.toBe(shared);
  });

  it("stays inside the 64-char IAM limit", () => {
    for (const stage of ["dev", "prod", "staging", "integration"]) {
      const name = computeCapabilityPrivateRoleName(
        stage,
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      );
      expect(name.length).toBeLessThanOrEqual(64);
    }
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

// --- (c) restricted role policy shape ---------------------------------------

describe("buildCapabilityPrivateInlinePolicy", () => {
  it("grants only CloudWatch Logs under the AgentCore runtime path", () => {
    const policy = buildCapabilityPrivateInlinePolicy(
      "us-east-1",
      "123456789012",
    ) as any;
    expect(policy.Statement).toHaveLength(1);
    const logs = policy.Statement[0];
    expect(logs.Sid).toBe("CapabilityPrivateCloudWatchLogs");
    expect(logs.Action).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
    expect(logs.Resource).toBe(
      "arn:aws:logs:us-east-1:123456789012:log-group:/aws/bedrock-agentcore/runtimes/*",
    );
  });

  it("lacks Secrets Manager, S3, and database/RDS access entirely", () => {
    const policy = buildCapabilityPrivateInlinePolicy(
      "us-east-1",
      "123456789012",
    ) as any;
    const flat = JSON.stringify(policy);
    expect(flat).not.toContain("secretsmanager");
    expect(flat).not.toContain("s3:");
    expect(flat).not.toContain("rds");
    expect(flat).not.toContain("dynamodb");
    // No wildcard tenant-secret ARN family the shared role carries.
    expect(flat).not.toContain("/sandbox/");
  });
});

// --- (a)/(b) handler provisioning gate --------------------------------------

describe("provisionTenantSandbox capability-private gate", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    iamCalls.length = 0;
    aciCalls.length = 0;
    dbUpdates.length = 0;
    process.env.STAGE = "dev";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCOUNT_ID = "123456789012";
    process.env.AGENTCORE_ADMIN_TOKEN = TOKEN;
    delete process.env.CAPABILITY_PRIVATE_SUBNET_IDS;
    delete process.env.CAPABILITY_PRIVATE_SECURITY_GROUP_IDS;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("(a) leaves the two-env path unchanged when VPC env vars are absent", async () => {
    const res: any = await handler(provisionEvent());
    expect(res.statusCode).toBe(200);

    const created = aciCalls.filter(
      (c) => c.name === "CreateCodeInterpreterCommand",
    );
    // Only default-public + internal-only — no capability-private.
    expect(created.map((c) => c.input.tags.Environment).sort()).toEqual([
      "default-public",
      "internal-only",
    ]);
    // Nobody passed a vpcConfig.
    expect(
      created.every(
        (c) => c.input.networkConfiguration.vpcConfig === undefined,
      ),
    ).toBe(true);
    // No capability-private role was created.
    const roleNames = iamCalls
      .filter((c) => c.name === "CreateRoleCommand")
      .map((c) => c.input.RoleName);
    expect(roleNames).toContain(computeRoleName("dev", TENANT));
    expect(roleNames).not.toContain(
      computeCapabilityPrivateRoleName("dev", TENANT),
    );
    // The capability-private column is not written when disabled.
    const set = dbUpdates.at(-1)!;
    expect(set).not.toHaveProperty("sandbox_interpreter_capability_private_id");
    expect(set).toHaveProperty("sandbox_interpreter_public_id");
    expect(set).toHaveProperty("sandbox_interpreter_internal_id");
  });

  it("(b) provisions capability-private with a vpcConfig + restricted role when env vars present", async () => {
    process.env.CAPABILITY_PRIVATE_SUBNET_IDS = "subnet-aaa, subnet-bbb";
    process.env.CAPABILITY_PRIVATE_SECURITY_GROUP_IDS = "sg-private";

    const res: any = await handler(provisionEvent());
    expect(res.statusCode).toBe(200);

    const created = aciCalls.filter(
      (c) => c.name === "CreateCodeInterpreterCommand",
    );
    expect(created.map((c) => c.input.tags.Environment).sort()).toEqual([
      "capability-private",
      "default-public",
      "internal-only",
    ]);

    const capPriv = created.find(
      (c) => c.input.tags.Environment === "capability-private",
    )!;
    expect(capPriv.input.networkConfiguration.networkMode).toBe("VPC");
    expect(capPriv.input.networkConfiguration.vpcConfig).toEqual({
      subnets: ["subnet-aaa", "subnet-bbb"],
      securityGroups: ["sg-private"],
    });
    // Uses the SEPARATE restricted role, not the shared sandbox role.
    const capRoleArn = `arn:aws:iam::123456789012:role/${computeCapabilityPrivateRoleName(
      "dev",
      TENANT,
    )}`;
    expect(capPriv.input.executionRoleArn).toBe(capRoleArn);
    // Every interpreter name must satisfy the AgentCore constraint
    // [a-zA-Z][a-zA-Z0-9_]{0,47} — hyphens are rejected with a
    // ValidationException (regression guard: names previously used hyphens).
    for (const c of created) {
      expect(c.input.name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/);
    }
    const publicCi = created.find(
      (c) => c.input.tags.Environment === "default-public",
    )!;
    expect(publicCi.input.executionRoleArn).not.toBe(capRoleArn);

    // The restricted role + its policy were provisioned.
    const capRoleName = computeCapabilityPrivateRoleName("dev", TENANT);
    expect(
      iamCalls.some(
        (c) =>
          c.name === "CreateRoleCommand" && c.input.RoleName === capRoleName,
      ),
    ).toBe(true);
    const capPolicyPut = iamCalls.find(
      (c) =>
        c.name === "PutRolePolicyCommand" && c.input.RoleName === capRoleName,
    )!;
    expect(capPolicyPut.input.PolicyName).toBe("capability-private-execution");
    expect(capPolicyPut.input.PolicyDocument).not.toContain("secretsmanager");

    // The third column is persisted when enabled.
    const set = dbUpdates.at(-1)!;
    expect(set).toHaveProperty(
      "sandbox_interpreter_capability_private_id",
      "ci-capability-private",
    );
  });
});
