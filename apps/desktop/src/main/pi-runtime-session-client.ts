import type {
  PiStartEvalRunRequest,
  PiPrewarmWorkspaceRequest,
  PiStartTurnRequest,
} from "@thinkwork/desktop-ipc";
import type { PreparedDesktopPiWorkspacePrewarmSession } from "./pi-sidecar-session.js";
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

export type PreparePiWorkspacePrewarmSession = (
  request: PiPrewarmWorkspaceRequest,
) => Promise<PreparedDesktopPiWorkspacePrewarmSession>;

export interface PreparedDesktopEvalWorkItem {
  runId: string;
  testCaseId: string;
  index: number;
  name: string;
  category: string;
  query: string;
  systemPrompt: string | null;
  assertions: unknown;
  agentcoreEvaluatorIds: string[];
  tags: string[];
  session: PreparedDesktopPiRuntimeSession;
}

export interface PreparedDesktopEvalRun {
  run: {
    id: string;
    status: string;
    totalTests: number;
  };
  target: {
    agentId: string;
    spaceId: string;
    spaceSlug: string;
    executionTarget: "desktop-pi";
    runtimeHost: "desktop-local";
  };
  resultCallback: {
    url: string;
    token: string;
    expiresAt: string;
    authScheme: "bearer";
  };
  workItems: PreparedDesktopEvalWorkItem[];
}

export type PreparePiEvalRun = (
  request: PiStartEvalRunRequest,
) => Promise<PreparedDesktopEvalRun>;

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

export function createPiEvalRunPreparer(
  options: PiRuntimeSessionClientOptions,
): PreparePiEvalRun {
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
      `${apiUrl}/api/desktop/eval-runs`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tenantId: request.tenantId,
          categories: request.categories,
          testCaseIds: request.testCaseIds,
          model: request.model,
          spaceId: request.spaceId,
        }),
      },
    );
    const json = (await response.json()) as unknown;
    if (!response.ok || !isPreparedEvalRunResponse(json)) {
      const error = readRecord(json);
      throw new Error(
        stringValue(error?.error) ??
          `Desktop eval run preparation failed (${response.status})`,
      );
    }
    return {
      run: json.run,
      target: json.target,
      resultCallback: json.resultCallback,
      workItems: json.workItems,
    };
  };
}

export function createPiWorkspacePrewarmPreparer(
  options: PiRuntimeSessionClientOptions,
): PreparePiWorkspacePrewarmSession {
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
      `${apiUrl}/api/desktop/workspace-prewarm`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          agentId: request.agentId,
          spaceId: request.spaceId,
        }),
      },
    );
    const json = (await response.json()) as unknown;
    if (!response.ok || !isPreparedWorkspacePrewarmResponse(json)) {
      const error = readRecord(json);
      throw new Error(
        stringValue(error?.error) ??
          `Desktop workspace prewarm preparation failed (${response.status})`,
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

function isPreparedWorkspacePrewarmResponse(
  value: unknown,
): value is { ok: true; session: PreparedDesktopPiWorkspacePrewarmSession } {
  const obj = readRecord(value);
  const session = readRecord(obj?.session);
  const workspace = readRecord(session?.workspace);
  const partition = readRecord(session?.partition);
  return (
    obj?.ok === true &&
    typeof session?.expiresAt === "string" &&
    typeof workspace?.bucket === "string" &&
    typeof workspace.renderedPrefix === "string" &&
    typeof partition?.tenantSlug === "string" &&
    typeof partition.agentSlug === "string" &&
    typeof partition.spaceId === "string" &&
    typeof partition.userId === "string"
  );
}

function isPreparedEvalRunResponse(
  value: unknown,
): value is { ok: true } & PreparedDesktopEvalRun {
  const obj = readRecord(value);
  const run = readRecord(obj?.run);
  const target = readRecord(obj?.target);
  const resultCallback = readRecord(obj?.resultCallback);
  const workItems = obj?.workItems;
  return (
    obj?.ok === true &&
    typeof run?.id === "string" &&
    typeof run.status === "string" &&
    typeof run.totalTests === "number" &&
    typeof target?.agentId === "string" &&
    typeof target.spaceId === "string" &&
    target.executionTarget === "desktop-pi" &&
    target.runtimeHost === "desktop-local" &&
    typeof resultCallback?.url === "string" &&
    typeof resultCallback.token === "string" &&
    typeof resultCallback.expiresAt === "string" &&
    resultCallback.authScheme === "bearer" &&
    Array.isArray(workItems) &&
    workItems.every(isPreparedEvalWorkItem)
  );
}

function isPreparedEvalWorkItem(value: unknown): boolean {
  const item = readRecord(value);
  const session = readRecord(item?.session);
  const invocation = readRecord(session?.invocation);
  return (
    typeof item?.runId === "string" &&
    typeof item.testCaseId === "string" &&
    typeof item.index === "number" &&
    typeof item.name === "string" &&
    typeof item.category === "string" &&
    typeof item.query === "string" &&
    Array.isArray(item.agentcoreEvaluatorIds) &&
    Array.isArray(item.tags) &&
    typeof session?.threadTurnId === "string" &&
    typeof session.expiresAt === "string" &&
    typeof session.finalizeCallbackSecret === "string" &&
    invocation?.runtime_host === "desktop-local"
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
