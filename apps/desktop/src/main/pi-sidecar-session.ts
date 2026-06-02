import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PreparedDesktopPiRuntimeSession } from "@thinkwork/pi-runtime-core";

export const PI_SIDECAR_PROTOCOL_VERSION = "0.1.0";

export interface PiSidecarTurnPayload {
  session: PreparedDesktopPiRuntimeSession;
  workspaceCacheRoot: string;
}

export interface PreparedDesktopPiWorkspacePrewarmSession {
  expiresAt: string;
  sidecarCredentials: unknown;
  workspace: {
    bucket: string;
    renderedPrefix: string;
  };
  partition: {
    stage?: string;
    tenantSlug: string;
    agentSlug: string;
    spaceId: string;
    userId: string;
  };
}

export interface PiSidecarWorkspacePrewarmPayload {
  session: PreparedDesktopPiWorkspacePrewarmSession;
  workspaceCacheRoot: string;
}

export interface PiSidecarEvalWorkItem {
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

export interface PiSidecarEvalRunPayload {
  runId: string;
  resultCallback: {
    url: string;
    token: string;
    expiresAt: string;
  };
  workItems: PiSidecarEvalWorkItem[];
  workspaceCacheRoot: string;
  parallelThreads?: number;
}

export type PiSidecarParentMessage =
  | {
      type: "ping";
    }
  | {
      type: "prewarm-workspace";
      requestId: string;
      payload: PiSidecarWorkspacePrewarmPayload;
    }
  | {
      type: "start-turn";
      requestId: string;
      payload: PiSidecarTurnPayload;
    }
  | {
      type: "start-eval-run";
      requestId: string;
      payload: PiSidecarEvalRunPayload;
    }
  | {
      type: "cancel-turn";
      requestId: string;
    }
  | {
      type: "cancel-eval-run";
      requestId: string;
    };

export function isPiSidecarParentMessage(
  message: unknown,
): message is PiSidecarParentMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as { type?: unknown; requestId?: unknown };
  if (candidate.type === "ping") return true;
  if (typeof candidate.requestId !== "string") return false;
  if (
    candidate.type === "cancel-turn" ||
    candidate.type === "cancel-eval-run"
  ) {
    return true;
  }
  if (candidate.type === "start-turn") return isPiSidecarTurnPayload(message);
  if (candidate.type === "start-eval-run") {
    return isPiSidecarEvalRunPayload(message);
  }
  if (candidate.type === "prewarm-workspace") {
    return isPiSidecarWorkspacePrewarmPayload(message);
  }
  return false;
}

export type PiSidecarChildMessage =
  | {
      type: "ready";
      version: string;
    }
  | {
      type: "pong";
      version: string;
    }
  | {
      type: "turn-accepted";
      requestId: string;
    }
  | {
      type: "workspace-prewarm-accepted";
      requestId: string;
    }
  | {
      type: "eval-run-accepted";
      requestId: string;
      runId: string;
      totalTests: number;
    }
  | {
      type: "turn-cancelled";
      requestId: string;
    }
  | {
      type: "eval-run-cancelled";
      requestId: string;
      runId?: string;
    }
  | {
      type: "diagnostic";
      level: "info" | "warn" | "error";
      message: string;
    };

const SECRET_VALUE_RE =
  /((?:access[_-]?key|secret|session[_-]?token|authorization|finalize[_-]?callback[_-]?secret|api[_-]?key)[=:]\s*)[^\s,;]+/gi;
const AUTHORIZATION_BEARER_VALUE_RE =
  /(authorization[=:]\s*)bearer\s+[^\s,;]+/gi;
const BEARER_TOKEN_RE = /(bearer\s+)[a-z0-9._~+/=-]+/gi;
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/g;
const JSON_SECRET_VALUE_RE =
  /("(?:access[_-]?key|secret|session[_-]?token|authorization|finalize[_-]?callback[_-]?secret|api[_-]?key|oauth[_-]?token|refresh[_-]?token)"\s*:\s*)"[^"]*"/gi;
const JSON_MESSAGE_VALUE_RE =
  /("(?:message|user[_-]?message|prompt|content)"\s*:\s*)"[^"]{12,}"/gi;
const S3_SIGNED_QUERY_RE =
  /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Amz-Date|X-Amz-Expires|X-Amz-SignedHeaders)=)[^&\s"]+/gi;
const OAUTH_TOKEN_RE =
  /\b(?:ya29\.[a-z0-9._-]+|gh[opsu]_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+)\b/gi;

export function resolvePiSidecarEntryPath(mainDir = currentMainDir()): string {
  return join(normalizeMainDir(mainDir), "pi-sidecar.js");
}

export function redactPiDiagnosticLine(line: string): string {
  return line
    .replace(JSON_SECRET_VALUE_RE, '$1"[redacted]"')
    .replace(JSON_MESSAGE_VALUE_RE, '$1"[redacted-message]"')
    .replace(S3_SIGNED_QUERY_RE, "$1[redacted]")
    .replace(OAUTH_TOKEN_RE, "[redacted-oauth-token]")
    .replace(AUTHORIZATION_BEARER_VALUE_RE, "$1[redacted]")
    .replace(BEARER_TOKEN_RE, "$1[redacted]")
    .replace(SECRET_VALUE_RE, "$1[redacted]")
    .replace(AWS_KEY_RE, "[redacted-aws-key]");
}

function isPiSidecarTurnPayload(
  message: unknown,
): message is { payload: PiSidecarTurnPayload } {
  const payload = (message as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as {
    workspaceCacheRoot?: unknown;
    session?: { invocation?: { runtime_host?: unknown } };
  };
  return (
    typeof candidate.workspaceCacheRoot === "string" &&
    candidate.session?.invocation?.runtime_host === "desktop-local"
  );
}

function isPiSidecarWorkspacePrewarmPayload(
  message: unknown,
): message is { payload: PiSidecarWorkspacePrewarmPayload } {
  const payload = (message as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as {
    workspaceCacheRoot?: unknown;
    session?: {
      expiresAt?: unknown;
      workspace?: { bucket?: unknown; renderedPrefix?: unknown };
      partition?: {
        tenantSlug?: unknown;
        agentSlug?: unknown;
        spaceId?: unknown;
        userId?: unknown;
      };
    };
  };
  return (
    typeof candidate.workspaceCacheRoot === "string" &&
    typeof candidate.session?.expiresAt === "string" &&
    typeof candidate.session.workspace?.bucket === "string" &&
    typeof candidate.session.workspace.renderedPrefix === "string" &&
    typeof candidate.session.partition?.tenantSlug === "string" &&
    typeof candidate.session.partition.agentSlug === "string" &&
    typeof candidate.session.partition.spaceId === "string" &&
    typeof candidate.session.partition.userId === "string"
  );
}

function isPiSidecarEvalRunPayload(
  message: unknown,
): message is { payload: PiSidecarEvalRunPayload } {
  const payload = (message as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as {
    runId?: unknown;
    workspaceCacheRoot?: unknown;
    resultCallback?: { url?: unknown; token?: unknown; expiresAt?: unknown };
    workItems?: unknown;
    parallelThreads?: unknown;
  };
  return (
    typeof candidate.runId === "string" &&
    typeof candidate.workspaceCacheRoot === "string" &&
    (candidate.parallelThreads === undefined ||
      (typeof candidate.parallelThreads === "number" &&
        Number.isInteger(candidate.parallelThreads) &&
        candidate.parallelThreads >= 1 &&
        candidate.parallelThreads <= 8)) &&
    typeof candidate.resultCallback?.url === "string" &&
    typeof candidate.resultCallback.token === "string" &&
    typeof candidate.resultCallback.expiresAt === "string" &&
    Array.isArray(candidate.workItems) &&
    candidate.workItems.every(isPiSidecarEvalWorkItem)
  );
}

function isPiSidecarEvalWorkItem(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as {
    runId?: unknown;
    testCaseId?: unknown;
    index?: unknown;
    name?: unknown;
    category?: unknown;
    query?: unknown;
    session?: { invocation?: { runtime_host?: unknown } };
    agentcoreEvaluatorIds?: unknown;
    tags?: unknown;
  };
  return (
    typeof item.runId === "string" &&
    typeof item.testCaseId === "string" &&
    typeof item.index === "number" &&
    typeof item.name === "string" &&
    typeof item.category === "string" &&
    typeof item.query === "string" &&
    Array.isArray(item.agentcoreEvaluatorIds) &&
    Array.isArray(item.tags) &&
    item.session?.invocation?.runtime_host === "desktop-local"
  );
}

function currentMainDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function normalizeMainDir(mainDir: string): string {
  return basename(mainDir) === "chunks" ? dirname(mainDir) : mainDir;
}
