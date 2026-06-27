import {
  InvokeCommand,
  type InvokeCommandInput,
  type LambdaClient,
} from "@aws-sdk/client-lambda";

export interface LambdaCallbackFetchOptions {
  fallbackFetch: typeof fetch;
  lambdaClient: Pick<LambdaClient, "send">;
  finalizeFunctionName: string;
  activityFunctionName: string;
  logger?: (entry: Record<string, unknown>) => void;
}

type CallbackTarget = "activity" | "finalize";

interface CallbackRoute {
  threadId: string;
  target: CallbackTarget;
}

function callbackRoute(url: URL): CallbackRoute | null {
  const match = url.pathname.match(
    /^\/api\/threads\/([^/]+)\/(activity|finalize)$/,
  );
  if (!match) return null;
  return {
    threadId: decodeURIComponent(match[1] ?? ""),
    target: match[2] as CallbackTarget,
  };
}

function functionNameForRoute(
  route: CallbackRoute,
  options: LambdaCallbackFetchOptions,
): string {
  return route.target === "activity"
    ? options.activityFunctionName
    : options.finalizeFunctionName;
}

function normalizeHeaders(
  input: HeadersInit | undefined,
): Record<string, string> {
  const headers = new Headers(input);
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function requestBodyToString(
  body: BodyInit | null | undefined,
): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  return String(body);
}

function decodeLambdaPayload(payload: Uint8Array | undefined): unknown {
  if (!payload || payload.length === 0) return null;
  return JSON.parse(new TextDecoder().decode(payload));
}

function responseFromLambdaResult(result: unknown): Response {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return new Response("Invalid Lambda proxy response", { status: 502 });
  }
  const proxy = result as {
    statusCode?: unknown;
    headers?: unknown;
    body?: unknown;
    isBase64Encoded?: unknown;
  };
  const status =
    typeof proxy.statusCode === "number" && proxy.statusCode > 0
      ? proxy.statusCode
      : 200;
  const headers =
    proxy.headers &&
    typeof proxy.headers === "object" &&
    !Array.isArray(proxy.headers)
      ? (proxy.headers as Record<string, string>)
      : undefined;
  const body =
    typeof proxy.body === "string"
      ? proxy.isBase64Encoded === true
        ? Buffer.from(proxy.body, "base64")
        : proxy.body
      : "";
  return new Response(body, { status, headers });
}

function buildApiGatewayEvent(args: {
  url: URL;
  route: CallbackRoute;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}): Record<string, unknown> {
  const routeKey = `POST /api/threads/{threadId}/${args.route.target}`;
  const now = Date.now();
  return {
    version: "2.0",
    routeKey,
    rawPath: args.url.pathname,
    rawQueryString: args.url.search.startsWith("?")
      ? args.url.search.slice(1)
      : "",
    headers: {
      host: args.url.host,
      ...args.headers,
    },
    requestContext: {
      accountId: "",
      apiId: "agentcore-pi-direct-callback",
      domainName: args.url.host,
      domainPrefix: "agentcore-pi-direct-callback",
      http: {
        method: args.method,
        path: args.url.pathname,
        protocol: "HTTP/1.1",
        sourceIp: "agentcore-pi",
        userAgent: "agentcore-pi-direct-callback",
      },
      requestId: `agentcore-pi-${now}`,
      routeKey,
      stage: "$default",
      time: new Date(now).toUTCString(),
      timeEpoch: now,
    },
    pathParameters: { threadId: args.route.threadId },
    body: args.body,
    isBase64Encoded: false,
  };
}

/**
 * Pi runs in the private application VPC. Public execute-api/custom-domain HTTP
 * callbacks are not reliable from there, so production chat callbacks invoke
 * the API Lambdas directly. Non-chat-callback URLs still use normal fetch.
 */
export function createLambdaCallbackFetch(
  options: LambdaCallbackFetchOptions,
): typeof fetch {
  return async (input, init) => {
    if (input instanceof Request) {
      return options.fallbackFetch(input, init);
    }

    const url = new URL(input.toString());
    const route = callbackRoute(url);
    if (!route) {
      return options.fallbackFetch(input, init);
    }

    const functionName = functionNameForRoute(route, options);
    if (!functionName) {
      options.logger?.({
        level: "warn",
        event: "lambda_callback_fetch_missing_function_name",
        target: route.target,
        threadId: route.threadId,
      });
      return options.fallbackFetch(input, init);
    }

    const method = (init?.method || "POST").toUpperCase();
    const event = buildApiGatewayEvent({
      url,
      route,
      method,
      headers: normalizeHeaders(init?.headers),
      body: requestBodyToString(init?.body),
    });
    const invokeInput: InvokeCommandInput = {
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(event)),
    };
    const response = await options.lambdaClient.send(
      new InvokeCommand(invokeInput),
    );
    if (response.FunctionError) {
      options.logger?.({
        level: "error",
        event: "lambda_callback_fetch_function_error",
        target: route.target,
        threadId: route.threadId,
        functionError: response.FunctionError,
      });
      return new Response("Lambda callback failed", { status: 502 });
    }
    return responseFromLambdaResult(decodeLambdaPayload(response.Payload));
  };
}
