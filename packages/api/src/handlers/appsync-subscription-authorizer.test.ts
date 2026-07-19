import { describe, expect, it, vi } from "vitest";
import { createAppSyncSubscriptionAuthorizer } from "./appsync-subscription-authorizer.js";

const connectClaims = {
  version: 1 as const,
  domain: "thinkwork.appsync.subscription.v1" as const,
  algorithm: "Ed25519" as const,
  keyId: "key-1",
  issuer: "thinkwork-auth" as const,
  stage: "dev",
  audience: "api-1",
  kind: "connect" as const,
  nonce: "nonce-1",
  issuedAt: 1,
  expiresAt: 61,
  cognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
  cognitoSub: "sub-1",
  userId: "user-1",
  tenantId: "tenant-1",
  routeClientId: "route-1",
  appClientId: "client-1",
};

const registrationClaims = {
  ...connectClaims,
  kind: "registration" as const,
  operationName: "OnNewMessage",
  operationHash: "hash-1",
  resourceKind: "thread",
  resourceId: "thread-1",
};

function dependencies(claims = connectClaims) {
  return {
    verify: vi.fn(() => claims as never),
    consume: vi.fn(async () => true),
    revalidate: vi.fn(async () => true),
  };
}

describe("AppSync subscription Lambda authorizer", () => {
  it("consumes a connect ticket only for DeepDish:Connect", async () => {
    const deps = dependencies();
    const result = await createAppSyncSubscriptionAuthorizer(deps)({
      authorizationToken: "twsub1_token",
      requestContext: { apiId: "api-1", operationName: "DeepDish:Connect" },
    });
    expect(result).toMatchObject({
      isAuthorized: true,
      ttlOverride: 0,
      resolverContext: { ticketKind: "connect", tenantId: "tenant-1" },
    });
    expect(deps.consume).toHaveBeenCalledOnce();
  });

  it("will not use a connect ticket for registration", async () => {
    const deps = dependencies();
    const result = await createAppSyncSubscriptionAuthorizer(deps)({
      authorizationToken: "twsub1_token",
      requestContext: {
        apiId: "api-1",
        operationName: "OnNewMessage",
        queryString:
          "subscription OnNewMessage { onNewMessage(threadId: 1) { messageId } }",
        variables: { threadId: "thread-1" },
      },
    });
    expect(result.isAuthorized).toBe(false);
    expect(deps.consume).not.toHaveBeenCalled();
  });

  it("will not use a registration ticket to open the socket", async () => {
    const deps = dependencies(registrationClaims as never);
    const result = await createAppSyncSubscriptionAuthorizer(deps)({
      authorizationToken: "twsub1_token",
      requestContext: { apiId: "api-1", operationName: "DeepDish:Connect" },
    });
    expect(result.isAuthorized).toBe(false);
  });

  it("authorizes an exact registration and disables caching", async () => {
    const deps = dependencies(registrationClaims as never);
    const result = await createAppSyncSubscriptionAuthorizer(deps)({
      authorizationToken: "twsub1_token",
      requestContext: {
        apiId: "api-1",
        operationName: "OnNewMessage",
        queryString:
          "subscription OnNewMessage { onNewMessage(threadId: 1) { messageId } }",
        variables: { threadId: "thread-1" },
      },
    });
    expect(result).toMatchObject({ isAuthorized: true, ttlOverride: 0 });
    expect(deps.consume).toHaveBeenCalledOnce();
    expect(deps.revalidate).toHaveBeenCalledOnce();
  });

  it("denies replay when atomic consumption has no winner", async () => {
    const deps = dependencies();
    deps.consume.mockResolvedValueOnce(false);
    const result = await createAppSyncSubscriptionAuthorizer(deps)({
      authorizationToken: "twsub1_token",
      requestContext: { apiId: "api-1", operationName: "DeepDish:Connect" },
    });
    expect(result.isAuthorized).toBe(false);
    expect(deps.revalidate).not.toHaveBeenCalled();
  });

  it("denies missing, invalid, and revoked admission without token detail", async () => {
    const missing = await createAppSyncSubscriptionAuthorizer(dependencies())(
      {},
    );
    expect(missing).toEqual({ isAuthorized: false, ttlOverride: 0 });

    const deps = dependencies();
    deps.verify.mockImplementationOnce(() => {
      throw Object.assign(new Error("private detail"), { code: "key_revoked" });
    });
    const invalid = await createAppSyncSubscriptionAuthorizer(deps)({
      authorizationToken: "cognito.jwt.value",
      requestContext: { apiId: "api-1", operationName: "DeepDish:Connect" },
    });
    expect(invalid).toEqual({ isAuthorized: false, ttlOverride: 0 });
  });
});
