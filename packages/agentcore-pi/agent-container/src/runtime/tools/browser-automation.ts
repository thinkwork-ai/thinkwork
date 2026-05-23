import {
  InvokeBrowserCommand,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
  type BedrockAgentCoreClient,
} from "@aws-sdk/client-bedrock-agentcore";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { validateMcpUrl } from "../../handler-context.js";
import {
  buildAgentCoreBrowserCost,
  sanitizeTelemetryUrl,
} from "./tool-costs.js";

const DEFAULT_BROWSER_IDENTIFIER = "aws.browser.v1";

function validHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("browser_automation requires a valid http(s) URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("browser_automation only supports public HTTPS URLs.");
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      "browser_automation does not accept credential-bearing URLs.",
    );
  }
  const validation = validateMcpUrl(parsed.toString());
  if (!validation.ok) {
    throw new Error(
      `browser_automation rejected URL (${validation.reason ?? "invalid-url"}).`,
    );
  }
  return parsed.toString();
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function browserActionResult(
  step: string,
  response: unknown,
): Record<string, unknown> {
  const result = (response as { result?: Record<string, unknown> }).result;
  const actionResult = result
    ? Object.values(result).find((value) => value && typeof value === "object")
    : null;
  if (!actionResult || typeof actionResult !== "object") {
    throw new Error(
      `${step} did not return an AgentCore Browser action result.`,
    );
  }
  const record = actionResult as Record<string, unknown>;
  if (record.status !== "SUCCESS") {
    const error =
      typeof record.error === "string" && record.error
        ? `: ${record.error}`
        : "";
    throw new Error(`${step} failed${error}`);
  }
  return record;
}

export interface BrowserAutomationToolOptions {
  client: BedrockAgentCoreClient;
  browserIdentifier?: string;
  traceId?: string;
  sessionTimeoutSeconds?: number;
  settleDelayMs?: number;
}

export function buildBrowserAutomationTool(
  options: BrowserAutomationToolOptions,
): AgentTool<any> {
  const browserIdentifier =
    options.browserIdentifier ||
    process.env.AGENTCORE_BROWSER_IDENTIFIER ||
    DEFAULT_BROWSER_IDENTIFIER;

  return {
    name: "browser_automation",
    label: "Browser",
    description:
      "Open a managed AgentCore Browser session, navigate to a public HTTPS URL, and " +
      "capture evidence that the page loaded.",
    parameters: Type.Object({
      url: Type.String({ description: "Starting public HTTPS URL." }),
      task: Type.Optional(
        Type.String({
          description:
            "Short browser task or what to verify after opening the URL.",
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const url = validHttpUrl(String((params as { url?: unknown }).url ?? ""));
      const telemetryUrl = sanitizeTelemetryUrl(url);
      const task = String((params as { task?: unknown }).task ?? "").trim();
      const started = Date.now();
      let sessionId: string | undefined;
      let result:
        | {
            content: Array<{ type: "text"; text: string }>;
            details: Record<string, unknown>;
          }
        | undefined;

      try {
        const startResponse = await options.client.send(
          new StartBrowserSessionCommand({
            browserIdentifier,
            name: `thinkwork-pi-${Date.now()}`,
            sessionTimeoutSeconds: options.sessionTimeoutSeconds ?? 300,
            viewPort: { width: 1280, height: 800 },
            traceId: options.traceId,
          }),
        );
        sessionId = startResponse.sessionId;
        if (!sessionId) {
          throw new Error("AgentCore Browser did not return a session id.");
        }

        browserActionResult(
          "Focus browser address bar",
          await options.client.send(
            new InvokeBrowserCommand({
              browserIdentifier,
              sessionId,
              action: { keyShortcut: { keys: ["CTRL", "L"] } },
            }),
          ),
        );
        browserActionResult(
          "Type browser URL",
          await options.client.send(
            new InvokeBrowserCommand({
              browserIdentifier,
              sessionId,
              action: { keyType: { text: url } },
            }),
          ),
        );
        browserActionResult(
          "Submit browser URL",
          await options.client.send(
            new InvokeBrowserCommand({
              browserIdentifier,
              sessionId,
              action: { keyPress: { key: "ENTER" } },
            }),
          ),
        );
        await wait(options.settleDelayMs ?? 3_000);
        const screenshot = await options.client.send(
          new InvokeBrowserCommand({
            browserIdentifier,
            sessionId,
            action: { screenshot: { format: "PNG" } },
          }),
        );
        const screenshotResult = browserActionResult(
          "Capture screenshot",
          screenshot,
        );
        const screenshotBytes =
          (screenshotResult.data as Uint8Array | undefined)?.byteLength ?? 0;
        if (screenshotBytes <= 0) {
          throw new Error("Capture screenshot returned no image data.");
        }
        const durationMs = Date.now() - started;
        const toolCosts = [
          buildAgentCoreBrowserCost({
            durationMs,
            url,
            task,
            sessionId,
            browserIdentifier,
            screenshotBytes,
          }),
        ];

        result = {
          content: [
            {
              type: "text",
              text:
                `Opened ${telemetryUrl} in AgentCore Browser for Pi.` +
                (task ? ` Task: ${task}.` : "") +
                ` Screenshot bytes: ${screenshotBytes}.`,
            },
          ],
          details: {
            runtime: "pi",
            browser_identifier: browserIdentifier,
            session_id: sessionId,
            url: telemetryUrl,
            task,
            screenshot_bytes: screenshotBytes,
            duration_ms: durationMs,
            tool_costs: toolCosts,
          },
        };
      } catch (err) {
        const durationMs = Date.now() - started;
        const message = err instanceof Error ? err.message : String(err);
        result = {
          content: [
            {
              type: "text",
              text: `Browser Automation error: ${message}`,
            },
          ],
          details: {
            runtime: "pi",
            ok: false,
            browser_identifier: browserIdentifier,
            session_id: sessionId,
            url: telemetryUrl,
            task,
            duration_ms: durationMs,
            error: "BrowserAutomationError",
            error_message: message,
            tool_costs: sessionId
              ? [
                  buildAgentCoreBrowserCost({
                    durationMs,
                    url,
                    task,
                    sessionId,
                    browserIdentifier,
                    error: message,
                  }),
                ]
              : [],
          },
        };
      } finally {
        if (sessionId) {
          try {
            await options.client.send(
              new StopBrowserSessionCommand({
                browserIdentifier,
                sessionId,
                traceId: options.traceId,
              }),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (result) {
              result.details.cleanup_failed = true;
              result.details.cleanup_error = message;
              result.details.cleanup_trace_id = options.traceId;
            }
          }
        }
      }
      if (!result) {
        throw new Error("browser_automation failed without a result payload.");
      }
      return result;
    },
  };
}
