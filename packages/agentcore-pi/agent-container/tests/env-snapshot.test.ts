import { describe, expect, it } from "vitest";
import { snapshotRuntimeEnv } from "../src/runtime/env-snapshot.js";

describe("snapshotRuntimeEnv", () => {
  it("captures the runtime deployment metadata", () => {
    expect(
      snapshotRuntimeEnv({
        AWS_REGION: "us-west-2",
        THINKWORK_GIT_SHA: "abc123",
        THINKWORK_BUILD_TIME: "2026-04-27T00:00:00Z",
      }),
    ).toEqual({
      awsRegion: "us-west-2",
      gitSha: "abc123",
      buildTime: "2026-04-27T00:00:00Z",
    });
  });
});
