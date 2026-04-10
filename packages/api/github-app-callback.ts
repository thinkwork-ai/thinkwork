/**
 * GitHub App OAuth Callback — proxies to API handler instead of Convex.
 */

interface APIGatewayProxyEventV2 {
  rawQueryString?: string;
}

interface APIGatewayProxyResultV2 {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

function text(statusCode: number, body: string): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, "");
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  // Use the REST API URL instead of Convex site URL
  const apiUrl = process.env.API_URL || process.env.CONVEX_SITE_URL;
  if (!apiUrl) {
    return text(500, "Server is not configured (API_URL missing)");
  }

  const callbackUrl = `${normalizeBaseUrl(apiUrl)}/api/github-app/callback${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;

  let response: Response;
  try {
    response = await fetch(callbackUrl, {
      method: "GET",
      redirect: "manual",
    });
  } catch (error: unknown) {
    return text(
      502,
      `Unable to reach callback service: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const location = response.headers.get("location");
  const bodyText = await response.text();

  if (location && response.status >= 300 && response.status < 400) {
    return {
      statusCode: response.status,
      headers: {
        Location: location,
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  return {
    statusCode: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: bodyText || (response.ok ? "OK" : "Request failed"),
  };
}
