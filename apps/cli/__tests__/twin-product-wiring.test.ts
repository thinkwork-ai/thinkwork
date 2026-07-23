import { describe, it, expect } from "vitest";

import {
  computeChannelDiff,
  mergeRunnerSecrets,
  readRunnerSecretChannel,
  parseRuntimeConfigNeptuneEndpoint,
  classifyWiring,
  resolveDeployModel,
  syncProductWiring,
  type WiringDeps,
} from "../src/lib/twin-product-wiring.js";

const DESIRED = {
  neptuneEndpoint: "twin.cluster-x.us-east-1.neptune.amazonaws.com",
  clusterResourceId: "cluster-ABC123",
  clientSgId: "sg-0abc",
  loadBucket: "etl-platform-neptune-load-1",
  loaderRoleArn: "arn:aws:iam::1:role/etl-platform-neptune-loader",
};

function deps(overrides: Partial<WiringDeps> = {}): WiringDeps & {
  writes: number;
  deploys: number;
} {
  const d = {
    writes: 0,
    deploys: 0,
    readChannel: async () => ({
      neptuneEndpoint: DESIRED.neptuneEndpoint,
      clusterResourceId: DESIRED.clusterResourceId,
      clientSgId: DESIRED.clientSgId,
      loadBucket: DESIRED.loadBucket,
      loaderRoleArn: DESIRED.loaderRoleArn,
    }),
    writeChannel: async () => {
      d.writes++;
    },
    runDeploy: async () => {
      d.deploys++;
    },
    readRuntimeConfig: async () =>
      JSON.stringify({ NEPTUNE_ENDPOINT: DESIRED.neptuneEndpoint }),
    ...overrides,
  };
  if (overrides.writeChannel) {
    const orig = overrides.writeChannel;
    d.writeChannel = async (x) => {
      d.writes++;
      return orig(x);
    };
  }
  if (overrides.runDeploy) {
    const orig = overrides.runDeploy;
    d.runDeploy = async () => {
      d.deploys++;
      return orig();
    };
  }
  return d;
}

describe("channel diff", () => {
  it("matching values → no-op reported as found-existing", async () => {
    const d = deps();
    const out = await syncProductWiring(DESIRED, d, { dryRun: false });
    expect(out.state).toBe("found");
    expect(d.writes).toBe(0);
    expect(d.deploys).toBe(0);
  });

  it("missing/stale values → write + deploy invoked", async () => {
    let rcCalls = 0;
    const d = deps({
      readChannel: async () => ({ neptuneEndpoint: null }),
      readRuntimeConfig: async () => {
        rcCalls++;
        return rcCalls === 1
          ? null
          : JSON.stringify({ NEPTUNE_ENDPOINT: DESIRED.neptuneEndpoint });
      },
    });
    const out = await syncProductWiring(DESIRED, d, { dryRun: false });
    expect(out.state).toBe("created");
    expect(d.writes).toBe(1);
    expect(d.deploys).toBe(1);
  });

  it("channel current but SSM empty → classified drifted, deploys anyway", async () => {
    let rcCalls = 0;
    const d = deps({
      readRuntimeConfig: async () => {
        rcCalls++;
        return rcCalls === 1
          ? JSON.stringify({})
          : JSON.stringify({ NEPTUNE_ENDPOINT: DESIRED.neptuneEndpoint });
      },
    });
    const out = await syncProductWiring(DESIRED, d, { dryRun: false });
    expect(out.state).toBe("created");
    expect(d.writes).toBe(0); // channel already current — only the deploy runs
    expect(d.deploys).toBe(1);
  });

  it("empty NEPTUNE_ENDPOINT after deploy → failure naming the runtime-config gap", async () => {
    const d = deps({
      readChannel: async () => ({}),
      readRuntimeConfig: async () => JSON.stringify({}),
    });
    const out = await syncProductWiring(DESIRED, d, { dryRun: false });
    expect(out.state).toBe("failed");
    expect(out.detail).toMatch(/runtime-config/);
    expect(out.detail).toMatch(/NEPTUNE_ENDPOINT/);
    expect(out.detail).not.toMatch(/^deploy failed/);
  });

  it("dry-run computes the diff without writing or deploying", async () => {
    const d = deps({ readChannel: async () => ({}) });
    const out = await syncProductWiring(DESIRED, d, { dryRun: true });
    expect(out.state).toBe("planned");
    expect(d.writes).toBe(0);
    expect(d.deploys).toBe(0);
  });
});

describe("mergeRunnerSecrets", () => {
  it("never writes keys other than the Neptune keys", () => {
    const before = {
      dbPassword: "s3cret",
      googleOauthClientId: "g-id",
      neptuneEndpoint: "old",
    };
    const after = JSON.parse(
      mergeRunnerSecrets(JSON.stringify(before), DESIRED),
    );
    expect(after.dbPassword).toBe("s3cret");
    expect(after.googleOauthClientId).toBe("g-id");
    expect(after.neptuneEndpoint).toBe(DESIRED.neptuneEndpoint);
    expect(after.neptuneClusterResourceId).toBe(DESIRED.clusterResourceId);
    expect(after.neptuneClientSecurityGroupId).toBe(DESIRED.clientSgId);
    expect(after.neptuneLoadBucket).toBe(DESIRED.loadBucket);
    expect(after.neptuneLoaderRoleArn).toBe(DESIRED.loaderRoleArn);
    expect(Object.keys(after).sort()).toEqual(
      [
        "dbPassword",
        "googleOauthClientId",
        "neptuneEndpoint",
        "neptuneClusterResourceId",
        "neptuneClientSecurityGroupId",
        "neptuneLoadBucket",
        "neptuneLoaderRoleArn",
      ].sort(),
    );
  });

  it("round-trips through readRunnerSecretChannel", () => {
    const doc = mergeRunnerSecrets("{}", DESIRED);
    const channel = readRunnerSecretChannel(doc);
    expect(computeChannelDiff(channel, DESIRED).current).toBe(true);
  });
});

describe("runtime-config parsing", () => {
  it("missing parameter or key = empty", () => {
    expect(parseRuntimeConfigNeptuneEndpoint(null)).toBe("");
    expect(parseRuntimeConfigNeptuneEndpoint("{}")).toBe("");
    expect(parseRuntimeConfigNeptuneEndpoint("not json")).toBe("");
  });

  it("reads the endpoint when present", () => {
    expect(
      parseRuntimeConfigNeptuneEndpoint(
        JSON.stringify({ NEPTUNE_ENDPOINT: "x" }),
      ),
    ).toBe("x");
  });
});

describe("classifyWiring", () => {
  it("current only when channel matches AND ssm carries the endpoint", () => {
    expect(
      classifyWiring({
        channelCurrent: true,
        ssmEndpoint: "e",
        desiredEndpoint: "e",
      }),
    ).toBe("current");
    expect(
      classifyWiring({
        channelCurrent: true,
        ssmEndpoint: "",
        desiredEndpoint: "e",
      }),
    ).toBe("drifted");
    expect(
      classifyWiring({
        channelCurrent: false,
        ssmEndpoint: "e",
        desiredEndpoint: "e",
      }),
    ).toBe("absent");
  });
});

describe("resolveDeployModel", () => {
  it("dev → github vars; everything else → controller", () => {
    expect(resolveDeployModel("dev")).toBe("dev-github");
    expect(resolveDeployModel("tei")).toBe("customer-controller");
    expect(resolveDeployModel("mcpherson")).toBe("customer-controller");
  });
});
