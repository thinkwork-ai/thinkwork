import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import { defineExtension, emptyToolParameters } from "./define-extension.js";

/**
 * Minimal reference extension establishing the authoring conventions for the
 * shared package: register a tool with `pi.registerTool`, subscribe to a
 * lifecycle event with `pi.on`, and reach host capabilities only through the
 * provider bundle. It is a scaffold placeholder — U5 replaces it with the real
 * memory extension. Imports are type-only except the typed empty schema, so the
 * package stays free of load-time side effects from the heavy SDK.
 */
export const stubExtension = defineExtension({
  name: "thinkwork-stub",
  register(pi, providers) {
    const ping: ToolDefinition = {
      name: "thinkwork_ping",
      label: "Ping",
      description:
        "Health-check tool that proves the thinkwork extension wiring is live.",
      parameters: emptyToolParameters,
      async execute() {
        return {
          content: [{ type: "text", text: "pong" }],
          details: undefined,
        };
      },
    };
    pi.registerTool(ping);

    // Convention demonstration: a lifecycle hook reaching a host capability
    // through the provider seam rather than constructing a client. This tool is
    // genuinely provider-optional (a ping needs nothing), so it reads the bundle
    // directly and tolerates absence. An extension that REQUIRES a capability
    // should instead acquire it via `requireProvider(providers, "memory", name)`
    // so a misconfigured host fails loud at load.
    pi.on("session_start", async () => {
      void providers.memory;
    });
  },
});
