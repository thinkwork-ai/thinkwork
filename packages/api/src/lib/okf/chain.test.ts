import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import {
  maybeChainOkfEfsRefresh,
  maybeChainOkfMaterialize,
  setOkfChainLambdaClient,
} from "./chain.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function fakeLambda() {
  const send = vi.fn(async () => ({}));
  setOkfChainLambdaClient({ send } as unknown as LambdaClient);
  return send;
}

function sentPayload(send: ReturnType<typeof vi.fn>, call = 0) {
  const command = send.mock.calls[call][0] as {
    input: {
      FunctionName: string;
      InvocationType: string;
      Payload: Uint8Array;
    };
  };
  return {
    fn: command.input.FunctionName,
    type: command.input.InvocationType,
    payload: JSON.parse(Buffer.from(command.input.Payload).toString("utf8")),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  setOkfChainLambdaClient(null);
  vi.unstubAllEnvs();
});

describe("maybeChainOkfMaterialize", () => {
  it("no-ops when the env gate is absent", async () => {
    const send = fakeLambda();
    const fired = await maybeChainOkfMaterialize({
      tenantId: TENANT_ID,
      status: "succeeded",
    });
    expect(fired).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("fires an async invoke on success when configured", async () => {
    vi.stubEnv("OKF_MATERIALIZE_FN_NAME", "thinkwork-dev-api-okf-materialize");
    const send = fakeLambda();
    const fired = await maybeChainOkfMaterialize({
      tenantId: TENANT_ID,
      status: "succeeded",
    });
    expect(fired).toBe(true);
    expect(sentPayload(send)).toEqual({
      fn: "thinkwork-dev-api-okf-materialize",
      type: "Event",
      payload: { tenantId: TENANT_ID },
    });
  });

  it("skips failed/skipped compiles and missing tenants", async () => {
    vi.stubEnv("OKF_MATERIALIZE_FN_NAME", "fn");
    const send = fakeLambda();
    expect(
      await maybeChainOkfMaterialize({ tenantId: TENANT_ID, status: "failed" }),
    ).toBe(false);
    expect(
      await maybeChainOkfMaterialize({ tenantId: null, status: "succeeded" }),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("an invoke failure is swallowed (best-effort)", async () => {
    vi.stubEnv("OKF_MATERIALIZE_FN_NAME", "fn");
    setOkfChainLambdaClient({
      send: vi.fn(async () => {
        throw new Error("lambda down");
      }),
    } as unknown as LambdaClient);
    await expect(
      maybeChainOkfMaterialize({ tenantId: TENANT_ID, status: "succeeded" }),
    ).resolves.toBe(false);
  });
});

describe("maybeChainOkfEfsRefresh", () => {
  it("fires with deduped slugs when configured", async () => {
    vi.stubEnv("OKF_EFS_REFRESH_FN_NAME", "thinkwork-dev-api-okf-efs-refresh");
    const send = fakeLambda();
    const fired = await maybeChainOkfEfsRefresh(["a-slug", "a-slug", "b-slug"]);
    expect(fired).toBe(true);
    expect(sentPayload(send).payload).toEqual({
      tenantSlugs: ["a-slug", "b-slug"],
    });
  });

  it("no-ops without env or with no published slugs", async () => {
    const send = fakeLambda();
    expect(await maybeChainOkfEfsRefresh(["a-slug"])).toBe(false);
    vi.stubEnv("OKF_EFS_REFRESH_FN_NAME", "fn");
    expect(await maybeChainOkfEfsRefresh([])).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
