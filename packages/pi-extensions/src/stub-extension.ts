import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import { defineExtension } from "./define-extension.js";

/**
 * Minimal reference extension establishing the authoring conventions for the
 * shared package: register a tool with `pi.registerTool`, subscribe to a
 * lifecycle event with `pi.on`, and reach host capabilities only through the
 * provider bundle. It is a scaffold placeholder — U5 replaces it with the real
 * memory extension. The tool def is a plain object (no runtime SDK import), so
 * the package stays free of load-time side effects.
 */
export const stubExtension = defineExtension({
  name: "thinkwork-stub",
  register(pi, providers) {
    const ping: ToolDefinition = {
      name: "thinkwork_ping",
      label: "Ping",
      description:
        "Health-check tool that proves the thinkwork extension wiring is live.",
      // Empty TypeBox object schema. Typed via the SDK's ToolDefinition; the
      // literal avoids importing the SDK's `Type` builder at runtime.
      parameters: { type: "object", properties: {} } as never,
      async execute() {
        return {
          content: [{ type: "text", text: "pong" }],
          details: undefined,
        };
      },
    };
    pi.registerTool(ping);

    // Convention demonstration: a lifecycle hook that reaches a host capability
    // through the provider seam rather than constructing a client. No-op when
    // the host supplies no memory provider — extensions degrade gracefully.
    pi.on("session_start", async () => {
      void providers.memory;
    });
  },
});
