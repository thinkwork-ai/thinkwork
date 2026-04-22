/**
 * Sandbox flagship end-to-end test.
 *
 * See docs/plans/2026-04-22-009-test-agentcore-code-sandbox-e2e-plan.md
 * Units 1-4 — Unit 4 fills in the real assertions.
 *
 * For now: Unit 1 scaffolding proves the harness loads + env wiring
 * works against a deployed stage. Running this against an
 * under-configured environment produces a specific HarnessEnvError
 * instead of a vitest timeout.
 */
import { describe, it, expect } from "vitest";
import { readHarnessEnv, HarnessEnvError } from "./_harness/index.js";

describe("sandbox-pilot E2E — harness loads", () => {
  it("readHarnessEnv surfaces missing env vars with a specific error", () => {
    expect(() => readHarnessEnv({})).toThrow(HarnessEnvError);
    try {
      readHarnessEnv({});
    } catch (err) {
      expect(err).toBeInstanceOf(HarnessEnvError);
      if (err instanceof HarnessEnvError) {
        expect(err.missing).toContain("THINKWORK_API_URL");
        expect(err.missing).toContain("API_AUTH_SECRET");
        expect(err.missing).toContain("DATABASE_URL");
      }
    }
  });

  it("readHarnessEnv returns a parsed struct when every var is present", () => {
    const env = readHarnessEnv({
      THINKWORK_API_URL: "https://example.com",
      API_AUTH_SECRET: "shhh",
      DATABASE_URL: "postgres://x",
      AWS_REGION: "us-east-1",
      STAGE: "dev",
      AGENTCORE_RUNTIME_LOG_GROUP: "/aws/bedrock-agentcore/runtimes/test",
      THINKWORK_E2E_OPERATOR_EMAIL: "eric@homecareintel.com",
    });
    expect(env.stage).toBe("dev");
    expect(env.operatorEmail).toBe("eric@homecareintel.com");
  });

  // Unit 4 lands the real flagship assertion — this test file intentionally
  // stays slim at Unit 1. The placeholder above proves `pnpm sandbox:e2e`
  // exits cleanly on a stage where env vars are set, and loudly when they
  // aren't.
  it.todo("Unit 4: full flagship demo — create fixtures, send prompt, assert audit + no token leak");
});
