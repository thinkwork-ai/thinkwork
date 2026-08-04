import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveChatAgentInvokeFnArn } from "../graphql/utils";

// THINK-583 U3 — provisioned concurrency only serves alias-qualified
// invokes. Every invoker of chat-agent-invoke and workspace-renderer must
// address the `live` alias; an unqualified invoke hits $LATEST and
// silently bypasses the warm pool. These tests pin the derivation code so
// a refactor cannot drop the qualifier without failing CI.

describe("chat-agent-invoke alias qualification (THINK-583 U3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("deriveChatAgentInvokeFnArn resolves to the :live alias ARN", () => {
    vi.stubEnv("STAGE", "unittest");
    vi.stubEnv("AWS_ACCOUNT_ID", "111122223333");
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(deriveChatAgentInvokeFnArn()).toBe(
      "arn:aws:lambda:us-east-1:111122223333:function:thinkwork-unittest-api-chat-agent-invoke:live",
    );
  });

  it("managed-dispatch derives the alias-qualified chat-agent-invoke ARN", () => {
    const source = readFileSync(
      join(__dirname, "../lib/mobile-turns/managed-dispatch.ts"),
      "utf8",
    );
    expect(source).toContain(
      "function:thinkwork-${stage}-api-chat-agent-invoke:live",
    );
  });
});

describe("workspace-renderer alias qualification (THINK-583 U3)", () => {
  // The helper is module-private in both handlers, so pin the source text:
  // the derived per-stage name must carry the `:live` qualifier.
  for (const handler of ["chat-agent-invoke.ts", "wakeup-processor.ts"]) {
    it(`${handler} invokes workspace-renderer via the :live alias`, () => {
      const source = readFileSync(join(__dirname, handler), "utf8");
      expect(source).toContain(
        '`${deriveFunctionName("workspace-renderer")}:live`',
      );
    });
  }
});
