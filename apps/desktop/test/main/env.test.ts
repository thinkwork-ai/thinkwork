import { describe, expect, it } from "vitest";
import { snapshotDesktopEnv } from "../../src/main/env";

describe("snapshotDesktopEnv", () => {
  it("captures expected desktop environment keys", () => {
    const snapshot = snapshotDesktopEnv({
      NODE_ENV: "production",
      THINKWORK_STAGE: "canary",
      ELECTRON_RENDERER_URL: "http://localhost:5174",
      VITE_COGNITO_USER_POOL_ID: "us-east-1_test",
      VITE_COGNITO_CLIENT_ID: "client-id",
      VITE_COGNITO_DOMAIN: "https://auth.example.com",
    });

    expect(snapshot).toEqual({
      nodeEnv: "production",
      stage: "canary",
      rendererUrl: "http://localhost:5174",
      cognito: {
        userPoolId: "us-east-1_test",
        clientId: "client-id",
        domain: "https://auth.example.com",
      },
    });
  });

  it("does not change when process.env changes after snapshot", () => {
    const env = {
      NODE_ENV: "development",
      VITE_THINKWORK_STAGE: "dev",
      ELECTRON_RENDERER_URL: "http://localhost:5174",
    };

    const snapshot = snapshotDesktopEnv(env);
    env.ELECTRON_RENDERER_URL = "http://localhost:9999";

    expect(snapshot.rendererUrl).toBe("http://localhost:5174");
  });
});
