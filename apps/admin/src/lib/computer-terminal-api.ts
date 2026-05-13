/**
 * Admin client for /api/computers/:computerId/terminal/start.
 *
 * Server contract lives in
 * packages/api/src/handlers/computer-terminal-start.ts. The handler
 * returns the raw `Session` envelope from the AWS ECS ExecuteCommand
 * API; the caller (ComputerTerminal.tsx) feeds it to `ssm-session` and
 * a browser WebSocket pointed at the streamUrl.
 */

import { getIdToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL || "";

export interface StartTerminalSessionResponse {
  sessionId: string;
  streamUrl: string;
  /** Short-lived bearer credential to a live shell. Never log or persist. */
  tokenValue: string;
  container: string;
  taskArn: string;
  idleTimeoutSec: number;
}

export async function startTerminalSession(
  computerId: string,
  opts: { command?: string } = {},
): Promise<StartTerminalSessionResponse> {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(
    `${API_URL}/api/computers/${encodeURIComponent(computerId)}/terminal/start`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(opts.command ? { command: opts.command } : {}),
    },
  );
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    sessionId?: string;
    streamUrl?: string;
    tokenValue?: string;
    container?: string;
    taskArn?: string;
    idleTimeoutSec?: number;
  };
  if (!res.ok || body.ok === false) {
    throw new Error(
      `Computer terminal start: ${res.status} ${body.error ?? res.statusText}`,
    );
  }
  if (!body.sessionId || !body.streamUrl || !body.tokenValue) {
    throw new Error("Computer terminal start: incomplete session payload");
  }
  return {
    sessionId: body.sessionId,
    streamUrl: body.streamUrl,
    tokenValue: body.tokenValue,
    container: body.container ?? "computer-runtime",
    taskArn: body.taskArn ?? "",
    idleTimeoutSec: body.idleTimeoutSec ?? 1200,
  };
}
