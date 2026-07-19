import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { getConfig } from "@thinkwork/runtime-config";

export interface AppSyncIamPublisherOptions {
  endpoint?: string;
  region?: string;
  fetchImpl?: typeof fetch;
  credentials?: ConstructorParameters<typeof SignatureV4>[0]["credentials"];
  skipSuppression?: boolean;
  suppressor?: (input: {
    tenantId: string;
    userId?: string | null;
    resourceKind?: string | null;
    resourceId?: string | null;
  }) => Promise<boolean>;
}

/**
 * Publish a notification mutation with the Lambda execution role. No static
 * AppSync credential is read, logged, or sent.
 */
export async function publishAppSyncMutation(
  query: string,
  variables: Record<string, unknown>,
  options: AppSyncIamPublisherOptions = {},
): Promise<boolean> {
  const endpoint = options.endpoint ?? getConfig("APPSYNC_ENDPOINT", "");
  const configuredRegion =
    options.region ?? getConfig("AWS_REGION", process.env.AWS_REGION ?? "");
  if (!endpoint) return false;
  if (!options.skipSuppression && typeof variables.tenantId === "string") {
    const resourceKind =
      typeof variables.threadId === "string"
        ? "thread"
        : typeof variables.userId === "string"
          ? "user"
          : "tenant";
    const resourceId =
      resourceKind === "thread"
        ? (variables.threadId as string)
        : resourceKind === "user"
          ? (variables.userId as string)
          : (variables.tenantId as string);
    const suppressor =
      options.suppressor ??
      (await import("./subscription-invalidation.js"))
        .shouldSuppressSubscriptionDelivery;
    if (
      await suppressor({
        tenantId: variables.tenantId,
        userId: typeof variables.userId === "string" ? variables.userId : null,
        resourceKind,
        resourceId,
      })
    ) {
      console.warn(
        "[appsync-iam-publisher] notification suppressed during revocation",
        {
          resourceKind,
        },
      );
      return false;
    }
  }
  const url = new URL(endpoint);
  const region =
    configuredRegion ||
    url.hostname.match(/\.appsync-api\.([a-z0-9-]+)\.amazonaws\.com$/)?.[1] ||
    "";
  if (!region) return false;
  const body = JSON.stringify({ query, variables });
  try {
    const signer = new SignatureV4({
      service: "appsync",
      region,
      credentials: options.credentials ?? lambdaExecutionCredentials,
      sha256: Hash.bind(null, "sha256"),
    });
    const request = await signer.sign(
      new HttpRequest({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        method: "POST",
        path: `${url.pathname}${url.search}`,
        headers: {
          host: url.host,
          "content-type": "application/json",
        },
        body,
      }),
    );
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: request.headers,
      body,
    });
    const responseBody = await response.text();
    let hasErrors = false;
    try {
      const decoded = JSON.parse(responseBody) as { errors?: unknown[] };
      hasErrors = Array.isArray(decoded.errors) && decoded.errors.length > 0;
    } catch {
      hasErrors = responseBody.length > 0 && !response.ok;
    }
    if (!response.ok || hasErrors) {
      console.error("[appsync-iam-publisher] notification rejected", {
        status: response.status,
        hasErrors,
      });
      return false;
    }
    return true;
  } catch (cause) {
    console.error("[appsync-iam-publisher] notification failed", {
      name: cause instanceof Error ? cause.name : "UnknownError",
    });
    return false;
  }
}

async function lambdaExecutionCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Lambda execution credentials unavailable");
  }
  return {
    accessKeyId,
    secretAccessKey,
    ...(process.env.AWS_SESSION_TOKEN
      ? { sessionToken: process.env.AWS_SESSION_TOKEN }
      : {}),
  };
}
