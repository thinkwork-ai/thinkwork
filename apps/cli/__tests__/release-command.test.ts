import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import { registerReleaseCommand } from "../src/commands/release.js";
import {
  buildControllerUpdateInput,
  controllerExecutionName,
  fetchRecentReleases,
  parsePriorControllerInput,
  resolveReleaseManifest,
} from "../src/commands/release/helpers.js";

describe("release command registration", () => {
  it("registers `release` with list and deploy subcommands", () => {
    const program = new Command();
    registerReleaseCommand(program);

    const release = program.commands.find((c) => c.name() === "release");
    expect(release, "release domain is registered").toBeTruthy();
    expect(release!.description()).toMatch(/deployment controller/i);

    const subNames = release!.commands.map((c) => c.name());
    expect(subNames).toEqual(expect.arrayContaining(["list", "deploy"]));
  });

  it("deploy carries --stage, --yes, and --no-wait flags (and the bare group mirrors them)", () => {
    const program = new Command();
    registerReleaseCommand(program);
    const release = program.commands.find((c) => c.name() === "release")!;
    const deploy = release.commands.find((c) => c.name() === "deploy")!;

    for (const cmd of [release, deploy]) {
      const longs = cmd.options.map((o) => o.long);
      expect(longs).toEqual(
        expect.arrayContaining(["--stage", "--yes", "--no-wait"]),
      );
    }
  });
});

describe("release flag parsing", () => {
  // Regression: -s/--yes/--no-wait are declared on BOTH the release group
  // and the deploy subcommand; commander parses post-subcommand duplicates
  // onto the PARENT, so the action must read command.optsWithGlobals().
  // The first real TEI deploy fell back to stage "dev" because of this.
  it("delivers -s/--yes placed after `deploy` to the handler", async () => {
    const deploySpy = vi.fn().mockResolvedValue(undefined);
    const program = new Command();
    registerReleaseCommand(program, deploySpy);

    await program.parseAsync(
      ["release", "deploy", "v0.1.0-canary.174", "-s", "tei-e2e", "--yes"],
      { from: "user" },
    );

    expect(deploySpy).toHaveBeenCalledTimes(1);
    const [version, opts] = deploySpy.mock.calls[0];
    expect(version).toBe("v0.1.0-canary.174");
    expect(opts.stage).toBe("tei-e2e");
    expect(opts.yes).toBe(true);
    expect(opts.wait).not.toBe(false);
  });

  it("delivers --no-wait and bare-group flags to the handler", async () => {
    const deploySpy = vi.fn().mockResolvedValue(undefined);
    const program = new Command();
    registerReleaseCommand(program, deploySpy);

    await program.parseAsync(["release", "-s", "tei-e2e", "--no-wait"], {
      from: "user",
    });

    expect(deploySpy).toHaveBeenCalledTimes(1);
    const [version, opts] = deploySpy.mock.calls[0];
    expect(version).toBeUndefined();
    expect(opts.stage).toBe("tei-e2e");
    expect(opts.wait).toBe(false);
  });
});

describe("fetchRecentReleases", () => {
  const gh = (overrides: Partial<Record<string, unknown>>[]) =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        overrides.map((o) => ({
          tag_name: "v0.1.0-canary.170",
          draft: false,
          published_at: "2026-06-11T00:00:00Z",
          assets: [
            {
              name: "thinkwork-release.json",
              browser_download_url: "https://example.com/m.json",
            },
          ],
          ...o,
        })),
    }) as unknown as typeof fetch;

  it("returns at most `limit` platform releases, newest first", async () => {
    const fetchImpl = gh([
      { tag_name: "v0.1.0-canary.175" },
      { tag_name: "v0.1.0-canary.174" },
      { tag_name: "v0.1.0-canary.173" },
      { tag_name: "v0.1.0-canary.172" },
      { tag_name: "v0.1.0-canary.171" },
      { tag_name: "v0.1.0-canary.170" },
    ]);
    const releases = await fetchRecentReleases(5, fetchImpl);
    expect(releases.map((r) => r.version)).toEqual([
      "v0.1.0-canary.175",
      "v0.1.0-canary.174",
      "v0.1.0-canary.173",
      "v0.1.0-canary.172",
      "v0.1.0-canary.171",
    ]);
  });

  it("filters drafts, desktop tags, and releases without a manifest asset", async () => {
    const fetchImpl = gh([
      { tag_name: "desktop-v0.2.1" },
      { tag_name: "v0.1.0-canary.175", draft: true },
      { tag_name: "v0.1.0-canary.174", assets: [] },
      { tag_name: "v0.1.0-canary.173" },
    ]);
    const releases = await fetchRecentReleases(5, fetchImpl);
    expect(releases.map((r) => r.version)).toEqual(["v0.1.0-canary.173"]);
  });

  it("throws on a non-OK API response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "rate limited",
    }) as unknown as typeof fetch;
    await expect(fetchRecentReleases(5, fetchImpl)).rejects.toThrow(/403/);
  });
});

describe("resolveReleaseManifest", () => {
  it("computes the sha256 of the manifest bytes and checks the declared version", async () => {
    const body = JSON.stringify({ release: { version: "0.1.0-canary.173" } });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }) as unknown as typeof fetch;

    const resolved = await resolveReleaseManifest(
      "v0.1.0-canary.173",
      fetchImpl,
    );
    expect(resolved.manifestUrl).toContain(
      "v0.1.0-canary.173/thinkwork-release.json",
    );
    expect(resolved.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects when the manifest declares a different version", async () => {
    const body = JSON.stringify({ release: { version: "0.1.0-canary.172" } });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }) as unknown as typeof fetch;

    await expect(
      resolveReleaseManifest("v0.1.0-canary.173", fetchImpl),
    ).rejects.toThrow(/declares version/);
  });

  it("rejects with a publish hint when the asset is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;
    await expect(
      resolveReleaseManifest("v0.1.0-canary.999", fetchImpl),
    ).rejects.toThrow(/Release workflow/);
  });
});

const PRIOR = {
  schemaVersion: 1,
  customerName: "ThinkWork",
  environmentName: "tei-e2e",
  awsAccountId: "637423202447",
  awsRegion: "us-east-1",
  availabilityZones: [],
  evidenceBucket: "thinkwork-tei-e2e-637423202447-deploy-evidence",
  releaseVersion: "v0.1.0-canary.172",
  agentcorePiSourceImageUri:
    "ghcr.io/thinkwork-ai/thinkwork-agentcore:pinned@sha256:abc",
  features: { baseInstall: { cognee: true }, optionalApps: [] },
  terraform: { stateRecovery: { mode: "state", recoverByTags: false } },
};

const PRIOR_WITH_DOMAIN = {
  ...PRIOR,
  runnerSecretArn:
    "arn:aws:secretsmanager:us-east-1:637423202447:secret:runner",
  preservedConfig: {
    customerDomain: "tei.thinkwork.ai",
    customerDomainDelegated: true,
    customerDomainLegacyRetired: false,
  },
};

describe("parsePriorControllerInput", () => {
  it("narrows a valid prior input", () => {
    const prior = parsePriorControllerInput(PRIOR);
    expect(prior.customerName).toBe("ThinkWork");
    expect(prior.releaseVersion).toBe("v0.1.0-canary.172");
  });

  it("extracts runner secrets and preserved customer domain config", () => {
    const prior = parsePriorControllerInput(PRIOR_WITH_DOMAIN);
    expect(prior.runnerSecretArn).toBe(PRIOR_WITH_DOMAIN.runnerSecretArn);
    expect(prior.customerDomain).toBe("tei.thinkwork.ai");
    expect(prior.customerDomainDelegated).toBe(true);
    expect(prior.customerDomainLegacyRetired).toBe(false);
  });

  it("throws a bootstrap hint when an environment fact is missing", () => {
    expect(() =>
      parsePriorControllerInput({ ...PRIOR, evidenceBucket: "" }),
    ).toThrow(/evidenceBucket/);
  });
});

describe("buildControllerUpdateInput", () => {
  const release = {
    version: "v0.1.0-canary.173",
    manifestUrl:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.173/thinkwork-release.json",
    manifestSha256: "b".repeat(64),
  };

  it("carries forward environment facts and pins the new release", () => {
    const prior = parsePriorControllerInput(PRIOR);
    const input = buildControllerUpdateInput({
      prior,
      release,
      sessionId: "session-1",
    });

    expect(input).toMatchObject({
      contract: "thinkwork.deployment.controller.v1",
      phase: "update",
      action: "update",
      source: "manual-cli",
      customerName: "ThinkWork",
      environmentName: "tei-e2e",
      awsAccountId: "637423202447",
      awsRegion: "us-east-1",
      evidenceBucket: PRIOR.evidenceBucket,
      runnerSecretArn: "/thinkwork/tei-e2e/deployment/runner-secrets",
      releaseVersion: "v0.1.0-canary.173",
      releaseManifestSha256: "b".repeat(64),
      terraformModuleVersion: "0.1.0-canary.173",
      agentcorePiSourceImageUri: PRIOR.agentcorePiSourceImageUri,
      features: PRIOR.features,
      operation: {
        kind: "foundation",
        action: "update",
        plan: true,
        apply: true,
        destroy: false,
      },
    });
    expect(input.evidence).toMatchObject({
      bucket: PRIOR.evidenceBucket,
      prefix: "settings/releases/v0.1.0-canary.173/session-1",
    });
    expect(input.release).toEqual(release);
  });

  it("preserves customer domain config on release update inputs", () => {
    const prior = parsePriorControllerInput(PRIOR_WITH_DOMAIN);
    const input = buildControllerUpdateInput({
      prior,
      release,
      sessionId: "session-1",
    });

    expect(input).toMatchObject({
      runnerSecretArn: PRIOR_WITH_DOMAIN.runnerSecretArn,
      preservedConfig: {
        customerDomain: "tei.thinkwork.ai",
        customerDomainDelegated: true,
        customerDomainLegacyRetired: false,
      },
      customerDomain: "tei.thinkwork.ai",
      customerDomainDelegated: true,
      customerDomainLegacyRetired: false,
    });
  });

  it("generates a session id when none is supplied", () => {
    const prior = parsePriorControllerInput(PRIOR);
    const input = buildControllerUpdateInput({ prior, release });
    expect(input.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("controllerExecutionName", () => {
  const now = new Date("2026-06-11T23:23:57.123Z");

  it("uses the short canary number and a compact UTC timestamp", () => {
    expect(controllerExecutionName("tei-e2e", "v0.1.0-canary.173", now)).toBe(
      "tw-tei-e2e-update-v173-20260611T232357Z",
    );
  });

  it("falls back to the sanitized full version without a canary suffix", () => {
    const name = controllerExecutionName("dev", "v1.2.3", now);
    expect(name).toBe("tw-dev-update-v1-2-3-20260611T232357Z");
  });

  it("stays within Step Functions' 80-char name limit", () => {
    const name = controllerExecutionName(
      "x".repeat(70),
      "v0.1.0-canary.173",
      now,
    );
    expect(name.length).toBeLessThanOrEqual(80);
  });
});
