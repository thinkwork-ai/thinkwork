import { describe, expect, it, vi } from "vitest";

import {
  resolveEnterpriseStageSecrets,
  setEnterpriseStageSecrets,
} from "../src/commands/enterprise/secrets.js";

describe("enterprise deployment secrets", () => {
  it("generates non-production secrets without persisting their values in results", async () => {
    const secrets = await resolveEnterpriseStageSecrets({
      stages: ["dev"],
      stdinIsTty: false,
      generateSecret: () => "generated-secret",
    });

    expect(secrets.dev).toEqual({
      TF_VAR_DB_PASSWORD: "generated-secret",
      TF_VAR_API_AUTH_SECRET: "generated-secret",
    });
  });

  it("requires explicit prod-like secrets in non-interactive mode", async () => {
    await expect(
      resolveEnterpriseStageSecrets({
        stages: ["prod"],
        stdinIsTty: false,
      }),
    ).rejects.toThrow(/TF_VAR_DB_PASSWORD is required/);
  });

  it("sets GitHub Environment secrets while keeping values out of summaries", async () => {
    const setter = {
      setEnvironmentSecret: vi.fn(async () => undefined),
    };

    const results = await setEnterpriseStageSecrets(
      "acme/deploy",
      {
        dev: {
          TF_VAR_DB_PASSWORD: "super-secret-db",
          TF_VAR_API_AUTH_SECRET: "super-secret-api",
        },
      },
      setter,
    );

    expect(setter.setEnvironmentSecret).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(results)).not.toContain("super-secret");
    expect(results[0].message).toContain("2 GitHub Environment secret");
  });
});
