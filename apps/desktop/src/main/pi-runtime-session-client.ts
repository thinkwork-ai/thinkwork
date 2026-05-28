import type { PiStartTurnRequest } from "@thinkwork/desktop-ipc";
import type { PreparedDesktopPiRuntimeSession } from "@thinkwork/pi-runtime-core";
import type { DesktopEnvSnapshot } from "./env.js";

export interface PiRuntimeSessionClientOptions {
  env: DesktopEnvSnapshot;
  tokenSnapshot: () => Record<string, string>;
  fetchImpl?: typeof fetch;
}

export type PreparePiRuntimeSession = (
  request: PiStartTurnRequest,
) => Promise<PreparedDesktopPiRuntimeSession>;

export function createPiRuntimeSessionPreparer(
  options: PiRuntimeSessionClientOptions,
): PreparePiRuntimeSession {
  return async (request) => {
    const apiUrl = options.env.apiUrl?.replace(/\/$/, "");
    if (!apiUrl) {
      throw new Error("Desktop API URL is not configured");
    }
    const idToken = resolveCognitoIdToken(
      options.tokenSnapshot(),
      options.env.cognito.clientId,
    );
    if (!idToken) {
      throw new Error("No authenticated Cognito desktop session is available");
    }

    const response = await (options.fetchImpl ?? fetch)(
      `${apiUrl}/api/desktop/runtime-session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          agentId: request.agentId,
          threadId: request.threadId,
          messageId: request.messageId,
          userMessage: request.userMessage,
          messageAttachments: request.messageAttachments,
        }),
      },
    );
    const json = (await response.json()) as unknown;
    if (!response.ok || !isPreparedSessionResponse(json)) {
      const error = readRecord(json);
      throw new Error(
        stringValue(error?.error) ??
          `Desktop runtime session preparation failed (${response.status})`,
      );
    }
    return json.session;
  };
}

export function resolveCognitoIdToken(
  items: Record<string, string>,
  clientId: string | null,
): string | null {
  if (!clientId) return null;
  const prefix = `CognitoIdentityServiceProvider.${clientId}`;
  const username = items[`${prefix}.LastAuthUser`];
  if (!username) return null;
  return items[`${prefix}.${username}.idToken`] ?? null;
}

function isPreparedSessionResponse(
  value: unknown,
): value is { ok: true; session: PreparedDesktopPiRuntimeSession } {
  const obj = readRecord(value);
  const session = readRecord(obj?.session);
  const invocation = readRecord(session?.invocation);
  return (
    obj?.ok === true &&
    typeof session?.threadTurnId === "string" &&
    typeof session.expiresAt === "string" &&
    typeof session.finalizeCallbackSecret === "string" &&
    typeof invocation?.tenant_id === "string" &&
    typeof invocation.assistant_id === "string" &&
    typeof invocation.thread_id === "string" &&
    invocation.runtime_host === "desktop-local"
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
