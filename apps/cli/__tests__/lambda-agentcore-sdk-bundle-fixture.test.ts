import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

describe("Lambda AgentCore SDK bundle safety", () => {
  it("bundles the workspace AgentCore SDK into wakeup-processor", () => {
    const script = readFileSync(
      resolve(REPO_ROOT, "scripts/build-lambdas.sh"),
      "utf8",
    );
    const bundledHandlerCondition = script.match(
      /if \[ "\$name" = "graphql-http" \][\s\S]*?; then\n\s+flags_ref="BUNDLED_AGENTCORE_ESBUILD_FLAGS\[@\]"/,
    )?.[0];

    expect(bundledHandlerCondition).toBeDefined();
    expect(bundledHandlerCondition).toContain(
      '[ "$name" = "wakeup-processor" ]',
    );
  });
});
