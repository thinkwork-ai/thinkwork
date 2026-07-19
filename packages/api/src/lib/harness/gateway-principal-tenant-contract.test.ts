import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function repositoryFile(path: string): string {
  return readFileSync(
    new URL(`../../../../../${path}`, import.meta.url),
    "utf8",
  );
}

describe("AgentCore Gateway principal-bound tenant contract", () => {
  it("keeps tenant identity out of model-controlled OpenAPI inputs", () => {
    const reconciler = repositoryFile(
      "terraform/modules/app/agentcore-gateway/scripts/reconcile_gateway.sh",
    );

    const openApi = reconciler.slice(
      reconciler.indexOf('openapi_payload="'),
      reconciler.indexOf('\n\njq -n \\\n  --arg name "$TARGET_NAME"'),
    );
    expect(openApi).not.toContain("tenant_id");
    expect(reconciler).not.toContain("context.input.tenant_id");
    expect(reconciler).toContain('principal.hasTag("tenant_id")');
  });

  it("tells the model that signed turn identity is never a tool argument", () => {
    const lifecycle = repositoryFile(
      "terraform/modules/app/agentcore-harness/scripts/harness-lifecycle.mjs",
    );

    expect(lifecycle).toContain(
      "Tenant and participant identity come exclusively from the signed turn and must never be supplied in tool arguments.",
    );
    expect(lifecycle).not.toContain("with tenant_id");
    expect(lifecycle).not.toContain("same tenant_id");
  });
});
