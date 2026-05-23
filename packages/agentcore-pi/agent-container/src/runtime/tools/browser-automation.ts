import {
  InvokeBrowserCommand,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
  type BedrockAgentCoreClient,
} from "@aws-sdk/client-bedrock-agentcore";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { buildAgentCoreBrowserCost } from "./tool-costs.js";

const DEFAULT_BROWSER_IDENTIFIER = "aws.browser.v1";

function validHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("browser_automation requires a valid http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("browser_automation only supports http(s) URLs.");
  }
  return parsed.toString();
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
      "Open a managed AgentCore Browser session, navigate to a URL, and " +
      "capture evidence that the page loaded.",
    parameters: Type.Object({
      url: Type.String({ description: "Starting http(s) URL." }),
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
      const task = String((params as { task?: unknown }).task ?? "").trim();
      const started = Date.now();
      let sessionId: string | undefined;

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

        await options.client.send(
          new InvokeBrowserCommand({
            browserIdentifier,
            sessionId,
            action: { keyShortcut: { keys: ["CTRL", "L"] } },
          }),
        );
        await options.client.send(
          new InvokeBrowserCommand({
            browserIdentifier,
            sessionId,
            action: { keyType: { text: url } },
          }),
        );
        await options.client.send(
          new InvokeBrowserCommand({
            browserIdentifier,
            sessionId,
            action: { keyPress: { key: "ENTER" } },
          }),
        );
        await wait(options.settleDelayMs ?? 3_000);
        const screenshot = await options.client.send(
          new InvokeBrowserCommand({
            browserIdentifier,
            sessionId,
            action: { screenshot: { format: "PNG" } },
          }),
        );
        const screenshotBytes =
          screenshot.result?.screenshot?.data?.byteLength ?? 0;
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

        return {
          content: [
            {
              type: "text",
              text:
                `Opened ${url} in AgentCore Browser for Pi.` +
                (task ? ` Task: ${task}.` : "") +
                ` Screenshot bytes: ${screenshotBytes}.`,
            },
          ],
          details: {
            runtime: "pi",
            browser_identifier: browserIdentifier,
            session_id: sessionId,
            url,
            task,
            screenshot_bytes: screenshotBytes,
            duration_ms: durationMs,
            tool_costs: toolCosts,
          },
        };
      } catch (err) {
        const durationMs = Date.now() - started;
        const message = err instanceof Error ? err.message : String(err);
        return {
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
            url,
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
          } catch {
            // The tool result is more useful than masking the browser evidence with cleanup failures.
          }
        }
      }
    },
  };
}
