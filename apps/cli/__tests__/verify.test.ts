import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  buildVerifyChecks,
  registerVerifyCommand,
} from "../src/commands/verify.js";

const BASE_CTX = {
  stage: "hprod-260701-001",
  region: "us-east-1",
  accountId: "123456789012",
};

describe("verify command registration", () => {
  it("registers with stage/region/api-auth-secret options", () => {
    const program = new Command();
    registerVerifyCommand(program);
    const cmd = program.commands.find((c) => c.name() === "verify");
    expect(cmd).toBeDefined();
    const flags = cmd!.options.map((o) => o.long);
    expect(flags).toContain("--stage");
    expect(flags).toContain("--region");
    expect(flags).toContain("--api-auth-secret");
  });
});

describe("buildVerifyChecks", () => {
  it("includes every distinct probe the plan requires (R8)", () => {
    const names = buildVerifyChecks(BASE_CTX).map((c) => c.name);
    expect(names).toContain("GraphQL API answers");
    expect(names).toContain("Authenticated API call");
    expect(names).toContain("Web app loads");
    expect(names).toContain("Database schema applied");
    expect(names).toContain("Hindsight health");
    expect(names).toContain("Workspace seeded");
    expect(names).toContain("Deployed artifact evidence");
  });

  it("core probes are blocking; pending-approval checks are warn-tier (AE3)", () => {
    const checks = buildVerifyChecks({
      ...BASE_CTX,
      domain: "acme.example.com",
      sesConfigured: true,
    });
    const blocking = checks.filter((c) => c.blocking !== false);
    const pending = checks.filter((c) => c.blocking === false);
    expect(blocking.length).toBeGreaterThanOrEqual(7);
    expect(pending.map((c) => c.name)).toEqual([
      "SES production access",
      "Domain DNS delegation (acme.example.com)",
    ]);
  });

  it("omits pending-approval checks when neither SES nor domain is configured", () => {
    const checks = buildVerifyChecks(BASE_CTX);
    expect(checks.every((c) => c.blocking !== false)).toBe(true);
  });

  it("authenticated probe fails fast without a bearer instead of passing vacuously", async () => {
    const auth = buildVerifyChecks(BASE_CTX).find(
      (c) => c.name === "Authenticated API call",
    )!;
    const result = await auth.run();
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("api_auth_secret");
  });
});
