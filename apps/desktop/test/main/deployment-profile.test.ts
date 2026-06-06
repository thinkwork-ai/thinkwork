import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDeploymentProfile,
  signDeploymentProfile,
} from "@thinkwork/deployment-profile";
import { DesktopDeploymentProfileManager } from "../../src/main/deployment-profile";
import type { DesktopEnvSnapshot } from "../../src/main/env";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("DesktopDeploymentProfileManager", () => {
  it("returns build-time env config when no profile is active", async () => {
    const manager = await createManager();

    await expect(manager.getDesktopConfig()).resolves.toMatchObject({
      stage: "dev",
      configured: true,
      deployment: {
        source: "env",
        displayName: "ThinkWork Spaces",
        trustStatus: "unsigned",
      },
      endpoints: {
        apiUrl: "https://api.example.com",
        cognitoDomain: "thinkwork-dev",
      },
    });
  });

  it("imports an unsigned development profile and uses it for runtime env", async () => {
    const manager = await createManager();
    const json = JSON.stringify(baseProfile());

    const config = await manager.importProfileJson(json);
    const env = await manager.activeEnv();

    expect(config).toMatchObject({
      stage: "customer-dev",
      configured: true,
      deployment: {
        source: "profile",
        deploymentId: "acme-dev",
        displayName: "Acme ThinkWork",
        stage: "customer-dev",
        region: "us-west-2",
        trustStatus: "unsigned",
      },
      endpoints: {
        apiUrl: "https://customer-api.example.com",
        cognitoDomain: "https://auth.customer.example.com",
      },
    });
    expect(config.deployment?.profileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(env.cognito.clientId).toBe("customer-client");
    expect(env.graphqlWsUrl).toBe("wss://customer-appsync.example.com/graphql");
  });

  it("preserves the current profile when a replacement import fails", async () => {
    const manager = await createManager();
    await manager.importProfileJson(JSON.stringify(baseProfile()));

    await expect(manager.importProfileJson("{nope")).rejects.toThrow(
      /malformed/i,
    );

    await expect(manager.getDesktopConfig()).resolves.toMatchObject({
      deployment: {
        source: "profile",
        deploymentId: "acme-dev",
      },
    });
  });

  it("rejects signed production profiles when no trusted key is configured", async () => {
    const manager = await createManager({
      ...baseEnv(),
      nodeEnv: "production",
    });
    const signed = await signDeploymentProfile({
      profile: baseProfile(),
      keyId: "deployment-profile-2026",
      issuer: "thinkwork",
      privateKeyPem: testPrivateKeyPem(),
      signedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-07-06T12:00:00.000Z",
    });

    await expect(
      manager.importProfileJson(JSON.stringify(signed)),
    ).rejects.toThrow(/no trusted profile signing keys/i);
  });

  it("removes the active profile and falls back to env", async () => {
    const manager = await createManager();
    await manager.importProfileJson(JSON.stringify(baseProfile()));

    await expect(manager.removeProfile()).resolves.toMatchObject({
      stage: "dev",
      deployment: {
        source: "env",
        deploymentId: null,
      },
    });
  });
});

async function createManager(env: DesktopEnvSnapshot = baseEnv()) {
  const dir = await mkdtemp(join(tmpdir(), "thinkwork-profile-"));
  tempDirs.push(dir);
  return new DesktopDeploymentProfileManager({
    app: {
      getPath: () => dir,
    },
    env,
    logger: {
      warn: () => undefined,
    },
  });
}

function baseEnv(): DesktopEnvSnapshot {
  return {
    nodeEnv: "development",
    stage: "dev",
    desktopChannel: "dev",
    desktopProductName: "ThinkWork Spaces",
    desktopAppId: "ai.thinkwork.spaces.desktop.dev",
    deepLinkScheme: null,
    rendererUrl: null,
    apiUrl: "https://api.example.com",
    graphqlHttpUrl: "https://api.example.com/graphql",
    graphqlUrl: "https://appsync.example.com/graphql",
    graphqlWsUrl: "wss://appsync.example.com/graphql",
    sandboxFrameSrc: null,
    cognito: {
      userPoolId: "us-east-1_abc",
      clientId: "dev-client",
      domain: "thinkwork-dev",
    },
  };
}

function baseProfile() {
  return buildDeploymentProfile({
    deploymentId: "acme-dev",
    displayName: "Acme ThinkWork",
    stage: "customer-dev",
    region: "us-west-2",
    issuedAt: "2026-06-06T12:00:00.000Z",
    spacesUrl: "https://spaces.customer.example.com",
    apiUrl: "https://customer-api.example.com",
    graphqlHttpUrl: "https://customer-api.example.com/graphql",
    appsyncHttpUrl: "https://customer-appsync.example.com/graphql",
    appsyncWsUrl: "wss://customer-appsync.example.com/graphql",
    cognitoDomain: "auth.customer.example.com",
    cognitoUserPoolId: "us-west-2_customer",
    cognitoClientId: "customer-client",
  });
}

function testPrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
