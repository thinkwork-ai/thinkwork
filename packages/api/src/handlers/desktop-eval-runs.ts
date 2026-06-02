/**
 * POST /api/desktop/eval-runs
 * POST /api/desktop/eval-runs/{runId}/sessions
 * POST /api/desktop/eval-runs/{runId}/results
 *
 * Tombstone for retired desktop-local Pi eval execution. Evaluation runs now
 * execute through managed backend paths instead of the Electron sidecar.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { desktopLocalExecutionRetired } from "../lib/desktop-local-retired.js";
import { error, handleCors } from "../lib/response.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  return desktopLocalExecutionRetired();
}
