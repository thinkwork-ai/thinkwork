// local-bash — the mobile harness's built-in Pi-style shell tool.
//
// This is intentionally a local extension, not an MCP/cloud shim: just-bash runs an
// in-memory bash-like sandbox inside the mobile JS runtime. That keeps command execution
// in the same place the mobile agent lives, while still letting the agent call public
// internet endpoints through curl/wget when a task needs it.

import { Bash } from "just-bash/browser";
import type { BashOptions } from "just-bash/browser";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { ToolResult } from "../types";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_SIZE_BYTES = 10 * 1024 * 1024;

export interface LocalBashExtensionOptions {
  /**
   * Stable key for the in-memory shell. Use the thread id so files/env survive across
   * turns while the app process is alive, without crossing thread boundaries.
   */
  sessionId?: string;
  /** Public internet access for curl/wget. Enabled by default per the mobile Pi contract. */
  network?: boolean;
  timeoutMs?: number;
}

const sandboxes = new Map<string, Bash>();

function sandboxKey(sessionId?: string): string {
  return sessionId?.trim() || "mobile-default";
}

function createBash(network: boolean): Bash {
  const options: BashOptions = {
    cwd: "/workspace",
    env: {
      HOME: "/workspace",
      PWD: "/workspace",
      PATH: "/bin:/usr/bin",
    },
    executionLimits: {
      maxCommandCount: 2_000,
      maxLoopIterations: 20_000,
      maxOutputSize: MAX_OUTPUT_SIZE_BYTES,
      maxStringLength: MAX_OUTPUT_SIZE_BYTES,
    },
    network: network
      ? {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          timeoutMs: 30_000,
          maxResponseSize: MAX_RESPONSE_SIZE_BYTES,
        }
      : undefined,
    python: false,
    javascript: false,
    defenseInDepth: true,
  };

  return new Bash(options);
}

function getBash(sessionId: string | undefined, network: boolean): Bash {
  const key = sandboxKey(sessionId);
  const existing = sandboxes.get(key);
  if (existing) return existing;

  const bash = createBash(network);
  sandboxes.set(key, bash);
  return bash;
}

function formatResult(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): ToolResult {
  const parts = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  if (result.exitCode !== 0) parts.push(`exitCode: ${result.exitCode}`);

  return {
    content: parts.length > 0 ? parts.join("\n") : "(no output)",
    isError: result.exitCode !== 0,
  };
}

function abortErrorMessage(timeoutMs: number): string {
  return `bash timed out after ${timeoutMs}ms`;
}

export function localBashExtension(
  options: LocalBashExtensionOptions = {},
): ExtensionFactory {
  const network = options.network ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return defineExtension({
    name: "local-bash",
    description: "Adds a local in-memory bash sandbox to the mobile agent.",
    register(pi) {
      pi.registerTool({
        name: "bash",
        description:
          "Run bash commands in the mobile app's local in-memory sandbox. Public internet access is enabled for curl/wget; private and loopback addresses are blocked. This is not the native iOS shell and cannot read arbitrary device files.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The bash command or script to run.",
            },
          },
          required: ["command"],
        },
        execute: async (args, ctx) => {
          const command =
            typeof args.command === "string" ? args.command.trim() : "";
          if (!command) {
            return {
              content: 'Missing required string argument "command".',
              isError: true,
            };
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => {
            controller.abort(new Error(abortErrorMessage(timeoutMs)));
          }, timeoutMs);
          const abortFromParent = () => {
            controller.abort(ctx.signal?.reason);
          };
          ctx.signal?.addEventListener("abort", abortFromParent, {
            once: true,
          });

          try {
            const bash = getBash(options.sessionId ?? ctx.sessionId, network);
            const result = await bash.exec(command, {
              signal: controller.signal,
            });
            return formatResult(result);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err || "failed");
            return {
              content:
                controller.signal.aborted && !message
                  ? abortErrorMessage(timeoutMs)
                  : `bash failed: ${message}`,
              isError: true,
            };
          } finally {
            clearTimeout(timeout);
            ctx.signal?.removeEventListener("abort", abortFromParent);
          }
        },
      });

      pi.on("before_agent_start", (e) => ({
        systemPrompt: `${e.systemPrompt}\n\nYou have a local \`bash\` tool. It runs inside an in-memory sandbox in the mobile app, with public internet access enabled for commands like curl and wget. Private/loopback network ranges are blocked, and it cannot access arbitrary native device files. Use it for command output, lightweight file work in the sandbox, builds/tests only when appropriate, and internet checks when the user asks. Do not claim command output unless it came from the bash tool.`,
      }));
    },
  });
}
