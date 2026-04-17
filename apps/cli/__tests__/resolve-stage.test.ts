import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCliConfig } from "../src/cli-config.js";
import { resolveStage } from "../src/lib/resolve-stage.js";
import * as awsDiscovery from "../src/aws-discovery.js";

// Sandbox HOME so we don't touch the developer's ~/.thinkwork/config.json.
let sandbox: string;
let originalHome: string | undefined;
let originalStageEnv: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "twcli-stage-"));
  originalHome = process.env.HOME;
  originalStageEnv = process.env.THINKWORK_STAGE;
  process.env.HOME = sandbox;
  delete process.env.THINKWORK_STAGE;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalStageEnv !== undefined) process.env.THINKWORK_STAGE = originalStageEnv;
  else delete process.env.THINKWORK_STAGE;
  rmSync(sandbox, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveStage precedence", () => {
  it("prefers an explicit --stage flag over everything else", async () => {
    process.env.THINKWORK_STAGE = "from-env";
    saveCliConfig({ defaultStage: "from-config" });
    const stage = await resolveStage({ flag: "from-flag" });
    expect(stage).toBe("from-flag");
  });

  it("falls back to THINKWORK_STAGE when no flag is passed", async () => {
    process.env.THINKWORK_STAGE = "from-env";
    saveCliConfig({ defaultStage: "from-config" });
    const stage = await resolveStage({});
    expect(stage).toBe("from-env");
  });

  it("falls back to defaultStage from config when no flag or env", async () => {
    saveCliConfig({ defaultStage: "from-config" });
    const stage = await resolveStage({});
    expect(stage).toBe("from-config");
  });

  it("uses the sole deployed stage when nothing else is set", async () => {
    vi.spyOn(awsDiscovery, "listDeployedStages").mockReturnValue(["only-one"]);
    const stage = await resolveStage({ region: "us-east-1" });
    expect(stage).toBe("only-one");
  });

  it("exits with a clear error when no stages are deployed and nothing else is set", async () => {
    vi.spyOn(awsDiscovery, "listDeployedStages").mockReturnValue([]);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveStage({ region: "us-east-1" }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("rejects invalid stage names", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveStage({ flag: "INVALID_UPPERCASE" }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("skips validation when `validate: false` is passed", async () => {
    const stage = await resolveStage({ flag: "ok-lowercase", validate: false });
    expect(stage).toBe("ok-lowercase");
  });
});
