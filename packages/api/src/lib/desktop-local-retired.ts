import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { json } from "./response.js";

export const DESKTOP_LOCAL_EXECUTION_RETIRED_CODE =
  "DESKTOP_LOCAL_EXECUTION_RETIRED";

export function desktopLocalExecutionRetired(): APIGatewayProxyStructuredResultV2 {
  return json(
    {
      ok: false,
      code: DESKTOP_LOCAL_EXECUTION_RETIRED_CODE,
      error:
        "Desktop-local Pi execution is retired. Use the managed AgentCore agent path.",
    },
    410,
  );
}
