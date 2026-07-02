/**
 * `thinkwork capabilities` — the effective capability set for an agent
 * context (capability-mapping plan U5).
 *
 * The terminal answer to "did my skill land?": renders every capability
 * class with its state and, for inactive items, the exact gate reason.
 * Read-only — Phase B write commands are deliberately out of scope.
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { gqlQuery } from "../lib/gql-client.js";
import {
  isJsonMode,
  printJson,
  printTable,
  setJsonMode,
} from "../lib/output.js";
import {
  resolveTenantContext,
  type TenantCliOptions,
} from "../lib/resolve-tenant-id.js";
import { printError } from "../ui.js";

const CapabilityInspectorDoc = graphql(`
  query CliCapabilityInspector(
    $tenantId: ID!
    $agentId: ID
    $spaceId: ID
    $agentProfileId: ID
    $perspectiveUserId: ID
  ) {
    capabilityInspector(
      tenantId: $tenantId
      agentId: $agentId
      spaceId: $spaceId
      agentProfileId: $agentProfileId
      perspectiveUserId: $perspectiveUserId
    ) {
      state
      stateDetail
      agentId
      noUserBaseline
      predicted {
        computedAt
        configFingerprint
        items {
          capabilityClass
          capabilityId
          displayName
          active
          provenance
          reason
          detail
          tokenStatus
        }
      }
    }
  }
`);

interface CapabilitiesCliOptions extends TenantCliOptions {
  agent?: string;
  space?: string;
  profile?: string;
  user?: string;
  json?: boolean;
}

async function runCapabilities(opts: CapabilitiesCliOptions): Promise<void> {
  if (opts.json) setJsonMode(true);
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, CapabilityInspectorDoc, {
    tenantId: ctx.tenantId,
    agentId: opts.agent ?? null,
    spaceId: opts.space ?? null,
    agentProfileId: opts.profile ?? null,
    perspectiveUserId: opts.user ?? null,
  });
  const inspection = data.capabilityInspector;

  if (isJsonMode()) {
    printJson(inspection);
    if (inspection.state !== "ok") process.exitCode = 1;
    return;
  }

  // Top-level failures are terminal states, distinct from per-item reasons.
  if (inspection.state === "invalid_selection") {
    printError(`Invalid selection: ${inspection.stateDetail}`);
    process.exitCode = 1;
    return;
  }
  if (inspection.state === "resolution_fault") {
    printError(`Resolution fault: ${inspection.stateDetail}`);
    process.exitCode = 1;
    return;
  }
  const predicted = inspection.predicted;
  if (!predicted) {
    printError("Inspector returned no capability set.");
    process.exitCode = 1;
    return;
  }

  if (inspection.noUserBaseline) {
    console.log(
      "No-user baseline (what a scheduled/wakeup turn gets). Pass --user <id> for a user's perspective.\n",
    );
  }

  printTable(
    predicted.items.map((item) => ({
      class: item.capabilityClass,
      id: item.displayName || item.capabilityId,
      state: item.active ? "active" : (item.reason ?? "inactive"),
      token: item.tokenStatus ?? "—",
      provenance: item.provenance ?? "—",
      detail: item.detail ?? "—",
    })),
    [
      { key: "class", header: "CLASS" },
      { key: "id", header: "CAPABILITY" },
      { key: "state", header: "STATE" },
      { key: "token", header: "TOKEN" },
      { key: "provenance", header: "PROVENANCE" },
      { key: "detail", header: "DETAIL" },
    ],
  );
  console.log(
    `\nComputed ${predicted.computedAt} · fingerprint ${predicted.configFingerprint.slice(0, 12)}`,
  );
}

export function registerCapabilitiesCommand(program: Command): void {
  program
    .command("capabilities")
    .description(
      "Effective capability set for an agent context — every skill, tool, MCP server, extension, and plugin with its state and gate reason.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <agentId>", "Agent id (defaults to the platform agent)")
    .option("--space <spaceId>", "Space id")
    .option("--profile <agentProfileId>", "Agent Profile id")
    .option(
      "--user <userId>",
      "Perspective user id (omit for the no-invoker baseline)",
    )
    .option("--json", "Raw JSON output")
    .action(runCapabilities);
}
