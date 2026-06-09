import { describe, expect, it } from "vitest";
import {
  evaluateKestraFlowPolicy,
  validateKestraNamespace,
} from "../kestra-control-policy.js";

const SAFE_FLOW = `id: daily_digest
namespace: thinkwork.crm

tasks:
  - id: hello
    type: io.kestra.plugin.core.log.Log
    message: Hello from ThinkWork
`;

describe("Kestra control flow policy", () => {
  it("accepts flows in the ThinkWork-owned namespace prefix", () => {
    const result = evaluateKestraFlowPolicy(SAFE_FLOW);

    expect(result).toMatchObject({
      ok: true,
      namespace: "thinkwork.crm",
      flowId: "daily_digest",
      errors: [],
    });
  });

  it("rejects writes outside the configured namespace prefix", () => {
    const result = evaluateKestraFlowPolicy(SAFE_FLOW, {
      allowedNamespacePrefix: "acme.tw",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      'namespace must be "acme.tw" or start with "acme.tw."',
    );
  });

  it("rejects Docker or host-execution task runners in managed Fargate flows", () => {
    const result = evaluateKestraFlowPolicy(`id: unsafe
namespace: thinkwork.ops

tasks:
  - id: docker_task
    type: io.kestra.plugin.docker.Run
    image: alpine
`);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "Docker or host-execution task runner configuration",
    );
  });

  it("validates direct namespace arguments with the same prefix rule", () => {
    expect(validateKestraNamespace("thinkwork.sales")).toEqual({
      ok: true,
      namespace: "thinkwork.sales",
    });
    expect(validateKestraNamespace("customer.sales")).toMatchObject({
      ok: false,
    });
  });
});
