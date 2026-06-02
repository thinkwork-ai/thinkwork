import { describe, expect, it } from "vitest";
import { snapshotDesktopEnv, validateDesktopEnv } from "../../src/main/env";

describe("snapshotDesktopEnv", () => {
  it("captures expected desktop environment keys", () => {
    const snapshot = snapshotDesktopEnv({
      NODE_ENV: "production",
      THINKWORK_STAGE: "canary",
      THINKWORK_DESKTOP_CHANNEL: "canary",
      THINKWORK_DESKTOP_PRODUCT_NAME: "ThinkWork Spaces (Canary)",
      THINKWORK_DESKTOP_APP_ID: "ai.thinkwork.spaces.desktop.canary",
      THINKWORK_DESKTOP_SCHEME: "thinkwork-canary",
      ELECTRON_RENDERER_URL: "http://localhost:5174",
      VITE_COGNITO_USER_POOL_ID: "us-east-1_test",
      VITE_COGNITO_CLIENT_ID: "client-id",
      VITE_COGNITO_DOMAIN: "https://auth.example.com",
    });

    expect(snapshot).toEqual({
      nodeEnv: "production",
      stage: "canary",
      desktopChannel: "canary",
      desktopProductName: "ThinkWork Spaces (Canary)",
      desktopAppId: "ai.thinkwork.spaces.desktop.canary",
      deepLinkScheme: "thinkwork-canary",
      rendererUrl: "http://localhost:5174",
      apiUrl: null,
      graphqlHttpUrl: null,
      graphqlUrl: null,
      graphqlWsUrl: null,
      sandboxFrameSrc: null,
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
    expect(snapshot.desktopChannel).toBe("dev");
    expect(snapshot.desktopProductName).toBe("ThinkWork Spaces");
    expect(snapshot.desktopAppId).toBe("ai.thinkwork.spaces.desktop.dev");
    expect(snapshot.deepLinkScheme).toBeNull();
  });

  it("ignores retired desktop local Pi env overrides", () => {
    expect(
      snapshotDesktopEnv({
        VITE_THINKWORK_STAGE: "prod",
        VITE_DESKTOP_LOCAL_PI_ENABLED: "true",
        THINKWORK_DESKTOP_LOCAL_PI_ENABLED: "true",
      }),
    ).not.toHaveProperty("desktopLocalPiEnabled");
  });

  it("treats blank packaged values as missing configuration", () => {
    const snapshot = snapshotDesktopEnv({
      VITE_API_URL: " ",
      VITE_GRAPHQL_HTTP_URL: "https://api.example.com/graphql",
      VITE_GRAPHQL_URL: "https://appsync.example.com/graphql",
      VITE_GRAPHQL_WS_URL: "wss://appsync.example.com/graphql",
      VITE_COGNITO_USER_POOL_ID: "us-east-1_test",
      VITE_COGNITO_CLIENT_ID: "",
      VITE_COGNITO_DOMAIN: "auth.example.com",
    });

    expect(validateDesktopEnv(snapshot)).toEqual({
      configured: false,
      missing: ["VITE_API_URL", "VITE_COGNITO_CLIENT_ID"],
    });
  });

  it("passes validation when first-launch backend and Cognito targets are baked in", () => {
    const snapshot = snapshotDesktopEnv({
      VITE_API_URL: "https://api.example.com",
      VITE_GRAPHQL_HTTP_URL: "https://api.example.com/graphql",
      VITE_GRAPHQL_URL: "https://appsync.example.com/graphql",
      VITE_GRAPHQL_WS_URL: "wss://appsync.example.com/graphql",
      VITE_COGNITO_USER_POOL_ID: "us-east-1_test",
      VITE_COGNITO_CLIENT_ID: "client-id",
      VITE_COGNITO_DOMAIN: "auth.example.com",
    });

    expect(validateDesktopEnv(snapshot)).toEqual({
      configured: true,
      missing: [],
    });
  });
});
