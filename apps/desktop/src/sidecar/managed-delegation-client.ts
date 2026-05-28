import type {
  DelegationProvider,
  ManagedDelegationRequest,
  ManagedDelegationResponse,
} from "@thinkwork/pi-runtime-core";

export interface ManagedDelegationClientOptions {
  apiUrl: string | undefined;
  parentThreadTurnId: string;
  finalizeCallbackSecret: string;
  fetchImpl?: typeof fetch;
}

export function createManagedDelegationClient(
  options: ManagedDelegationClientOptions,
): DelegationProvider {
  return {
    async delegate(request) {
      return postManagedDelegation(options, request);
    },
  };
}

async function postManagedDelegation(
  options: ManagedDelegationClientOptions,
  request: ManagedDelegationRequest,
): Promise<ManagedDelegationResponse> {
  if (!options.apiUrl) {
    throw new Error("ThinkWork API URL is not configured for delegation");
  }
  const response = await (options.fetchImpl ?? fetch)(
    `${options.apiUrl.replace(/\/$/, "")}/api/desktop/managed-delegation`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.finalizeCallbackSecret}`,
      },
      body: JSON.stringify({
        parentThreadTurnId: options.parentThreadTurnId,
        task: request.task,
        visibility: request.visibility ?? "hidden",
        reason: request.reason,
        timeoutMs: request.timeoutMs,
      }),
    },
  );
  const json = (await response.json()) as unknown;
  if (!response.ok || !isManagedDelegationResponse(json)) {
    const error = readRecord(json);
    throw new Error(
      stringValue(error?.error) ??
        `Managed delegation failed (${response.status})`,
    );
  }
  return json;
}

function isManagedDelegationResponse(
  value: unknown,
): value is ManagedDelegationResponse {
  const obj = readRecord(value);
  return (
    obj?.ok === true &&
    typeof obj.delegationId === "string" &&
    typeof obj.parentThreadTurnId === "string" &&
    (typeof obj.childThreadTurnId === "string" ||
      obj.childThreadTurnId === null) &&
    (obj.status === "accepted" ||
      obj.status === "completed" ||
      obj.status === "failed")
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
