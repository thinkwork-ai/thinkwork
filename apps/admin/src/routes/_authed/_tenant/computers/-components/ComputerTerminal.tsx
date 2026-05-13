/**
 * ComputerTerminal — in-browser xterm.js terminal that connects to a
 * running Computer ECS task via AWS ECS Exec / SSM Session Manager.
 *
 * Architecture:
 *   1. POST /api/computers/:computerId/terminal/start (Cognito JWT +
 *      tenant-admin gate) returns { sessionId, streamUrl, tokenValue,
 *      idleTimeoutSec }. The Lambda calls ecs:ExecuteCommand and
 *      forwards the raw SSM session envelope.
 *   2. Browser opens a WebSocket directly to streamUrl (wss://
 *      ssmmessages.<region>.amazonaws.com/...). CORS does not apply to
 *      WebSocket upgrades; AWS Console works the same way.
 *   3. ssm-session decodes/encodes the AWS Message Gateway Service
 *      binary protocol (sequence numbers, SHA-256 digests, ACKs,
 *      handshake) so we don't have to.
 *   4. xterm.js renders + captures input. Resize → ssm.sendInitMessage
 *      with the new {cols, rows}.
 *
 * Gotchas captured:
 *   - 20-minute idle timeout on ECS Exec sessions (fixed, not
 *     configurable). On WS close we show a Reconnect button.
 *   - tokenValue is a short-lived bearer credential; we keep it in
 *     component state only and never persist or log it.
 *   - PayloadType 17 means "ready/sync" — agent wants the term options
 *     re-sent. Resend the InitMessage.
 *
 * Plan: docs/plans/2026-05-13-004-feat-computer-terminal-ecs-exec-plan.md.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
// ssm-session is shipped CommonJS without typings; the named export is
// the same `ssm` object documented in the README.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no types published
import { ssm } from "ssm-session";
import { Button } from "@/components/ui/button";
import { startTerminalSession } from "@/lib/computer-terminal-api";
import { cn } from "@/lib/utils";

interface Props {
  computerId: string;
  className?: string;
}

type SessionState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "open"; sessionId: string }
  | { kind: "closed"; reason: string }
  | { kind: "error"; error: string };

export function ComputerTerminal({ computerId, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [session, setSession] = useState<SessionState>({ kind: "idle" });
  const decoderRef = useRef(new TextDecoder());
  const encoderRef = useRef(new TextEncoder());

  const teardown = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        /* ignore */
      }
      socketRef.current = null;
    }
    if (terminalRef.current) {
      try {
        terminalRef.current.dispose();
      } catch {
        /* ignore */
      }
      terminalRef.current = null;
    }
    fitRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!containerRef.current) return;
    teardown();
    setSession({ kind: "connecting" });

    let envelope;
    try {
      envelope = await startTerminalSession(computerId);
    } catch (err) {
      setSession({
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const term = new Terminal({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: { background: "#0a0a0a" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    terminalRef.current = term;
    fitRef.current = fit;

    const socket = new WebSocket(envelope.streamUrl);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    const termOptions = { rows: term.rows, cols: term.cols };

    socket.addEventListener("open", () => {
      ssm.init(socket, { token: envelope.tokenValue, termOptions });
      setSession({ kind: "open", sessionId: envelope.sessionId });
      term.focus();
    });

    socket.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      const agentMessage = ssm.decode(event.data);
      ssm.sendACK(socket, agentMessage);
      if (agentMessage.payloadType === 1) {
        term.write(decoderRef.current.decode(agentMessage.payload));
      } else if (agentMessage.payloadType === 17) {
        // Agent ready — resend size so the PTY matches the terminal.
        ssm.sendInitMessage(socket, {
          rows: term.rows,
          cols: term.cols,
        });
      }
    });

    socket.addEventListener("error", () => {
      setSession({ kind: "error", error: "WebSocket error" });
    });

    socket.addEventListener("close", () => {
      // ECS Exec idle timeout is 20 min; treat any close as
      // "session ended — reconnect to continue".
      setSession((prev) =>
        prev.kind === "error" || prev.kind === "closed"
          ? prev
          : { kind: "closed", reason: "Session ended" },
      );
    });

    term.onData((data) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        ssm.sendText(socketRef.current, encoderRef.current.encode(data));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        ssm.sendInitMessage(socketRef.current, { cols, rows });
      }
    });
  }, [computerId, teardown]);

  // Auto-start on mount; tear down on unmount or computerId change.
  useEffect(() => {
    void connect();
    return teardown;
  }, [connect, teardown]);

  // Fit terminal to container on window resize.
  useEffect(() => {
    function onResize() {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className={cn("relative flex flex-col", className)}>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden rounded-md border bg-[#0a0a0a] p-2"
        data-testid="computer-terminal"
      />
      <TerminalOverlay session={session} onReconnect={connect} />
    </div>
  );
}

function TerminalOverlay({
  session,
  onReconnect,
}: {
  session: SessionState;
  onReconnect: () => void;
}) {
  if (session.kind === "open" || session.kind === "idle") return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-md border bg-background p-6 text-sm text-muted-foreground shadow-lg">
        {session.kind === "connecting" ? (
          <span>Opening ECS Exec session…</span>
        ) : null}
        {session.kind === "closed" ? (
          <>
            <span>{session.reason}</span>
            <Button variant="outline" size="sm" onClick={onReconnect}>
              Reconnect
            </Button>
          </>
        ) : null}
        {session.kind === "error" ? (
          <>
            <span className="text-destructive">{session.error}</span>
            <Button variant="outline" size="sm" onClick={onReconnect}>
              Retry
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
