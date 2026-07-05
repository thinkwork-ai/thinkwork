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
import { apiFetch, resolveApiConfig } from "../api-client.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveTenantRest } from "../lib/resolve-tenant-rest.js";

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
  const capabilities = program
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

  // THINK-173 U11: operator backfill — DB capability state → signed
  // workspace folders, with a divergence-gated per-agent flag flip.
  capabilities
    .command("backfill")
    .description(
      "Backfill DB capability state into signed workspace folders (THINK-173). Dry-run by default; --apply writes folders, --flip runs the divergence check and flips capability_folder_dispatch per agent, --scrub (with --flip) replaces inline auth_config secrets with migration markers once the whole tenant is flipped.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--apply", "Write connection/tool folders (default: dry-run)")
    .option("--flip", "Divergence check + per-agent flag flip")
    .option("--scrub", "Scrub inline auth_config secrets (requires --flip)")
    .option("--json", "Raw JSON report")
    .addHelpText(
      "after",
      `
Examples:
  # Dry-run collision report only
  $ thinkwork capabilities backfill -s dev -t acme

  # Write folders, then verify + flip agents whose surfaces match
  $ thinkwork capabilities backfill -s dev -t acme --apply
  $ thinkwork capabilities backfill -s dev -t acme --apply --flip

  # Full cutover for a tenant (after both live E2Es are green)
  $ thinkwork capabilities backfill -s dev -t acme --apply --flip --scrub
`,
    )
    .action(async (opts: BackfillCliOptions) => {
      await runCapabilitiesBackfill(opts);
    });
}

interface BackfillCliOptions {
  stage?: string;
  tenant?: string;
  apply?: boolean;
  flip?: boolean;
  scrub?: boolean;
  json?: boolean;
}

async function runCapabilitiesBackfill(opts: BackfillCliOptions) {
  setJsonMode(opts.json === true);
  const stage = await resolveStage({ flag: opts.stage });
  const api = resolveApiConfig(stage);
  if (!api) process.exit(1);
  const tenant = await resolveTenantRest({
    flag: opts.tenant,
    stage,
    apiUrl: api.apiUrl,
    authSecret: api.authSecret,
  });

  if (opts.scrub && !opts.flip) {
    printError("--scrub requires --flip");
    process.exit(1);
  }

  try {
    const report = await apiFetch(
      api.apiUrl,
      api.authSecret,
      "/api/skills/capabilities/backfill",
      {
        method: "POST",
        body: JSON.stringify({
          apply: opts.apply === true,
          flip: opts.flip === true,
          scrub: opts.scrub === true,
        }),
      },
      { "x-tenant-slug": tenant.slug },
    );

    if (isJsonMode()) {
      printJson(report);
      return;
    }

    const summary = report.summary ?? {};
    console.log(
      `
Backfill ${report.mode?.apply ? "APPLY" : "DRY-RUN"}${report.mode?.flip ? " + FLIP" : ""}${report.mode?.scrub ? " + SCRUB" : ""} — tenant ${report.tenantSlug ?? report.tenantId}`,
    );
    const rows = (report.agents ?? []).map(
      (agent: {
        agentSlug: string;
        proposedConnections: unknown[];
        proposedPlatformTools: unknown[];
        collisions: unknown[];
        applied?: {
          written: unknown[];
          unchanged: unknown[];
          errors: unknown[];
        };
        alreadyFlipped: boolean;
        flipped?: boolean;
        divergence?: { equal: boolean };
      }) => ({
        agent: agent.agentSlug,
        connections: String(agent.proposedConnections.length),
        platformTools: String(agent.proposedPlatformTools.length),
        collisions:
          agent.collisions.length > 0 ? `⚠ ${agent.collisions.length}` : "0",
        applied: agent.applied
          ? `${agent.applied.written.length}w/${agent.applied.unchanged.length}u${agent.applied.errors.length > 0 ? `/${agent.applied.errors.length}err` : ""}`
          : "—",
        flipped: agent.alreadyFlipped
          ? "already"
          : agent.flipped === true
            ? "yes"
            : agent.divergence && !agent.divergence.equal
              ? "DIVERGENT"
              : "—",
      }),
    );
    printTable(rows, [
      { key: "agent", header: "Agent" },
      { key: "connections", header: "Connections" },
      { key: "platformTools", header: "Platform tools" },
      { key: "collisions", header: "Collisions" },
      { key: "applied", header: "Applied" },
      { key: "flipped", header: "Flipped" },
    ]);
    console.log(
      `
${summary.agents} agents · ${summary.proposedConnections} connections · ${summary.collisions} collisions · ${summary.flipped} flipped · ${summary.divergent} divergent`,
    );
    if (report.scrub) {
      console.log(
        report.scrub.ran
          ? `Scrubbed inline secrets on ${report.scrub.servers.length} registry row(s).`
          : `Scrub blocked: ${report.scrub.blockedReason}`,
      );
    }
  } catch (err) {
    printError(
      `Backfill failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
