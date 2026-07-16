import { Command } from "commander";
import {
  moveConnectionsToConnectors,
  type ConnectorsMoveMode,
} from "../lib/migrations/connectors-mover.js";
import {
  AwsCliWorkspaceObjectStore,
  resolveWorkspaceBucketFromLambda,
} from "./migrate-folder-canon.js";

export function registerMigrateConnectorsCommand(program: Command): void {
  program
    .command("migrate-connectors")
    .description(
      "Move legacy connections/ capability folders to connectors/ and leave a tombstone (subagent-folders U15). Run only against a stack running the connectors flip.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug to move")
    .option("--agent <slug>", "Limit to one agent slug under the tenant")
    .option("--workspace-bucket <bucket>", "Workspace S3 bucket override")
    .option("--dry-run", "Read and report planned moves without mutating")
    .option(
      "--apply",
      "Copy to connectors/, delete old objects, write tombstone",
    )
    .option(
      "--noop-check",
      "Exit nonzero if any move operation would still be needed.",
    )
    .action(async (opts, cmd) => {
      const parent = cmd.parent as Command | undefined;
      const mode = resolveMode(opts);
      const stage = opts.stage ?? parent?.opts().stage;
      const bucket =
        opts.workspaceBucket ??
        process.env.WORKSPACE_BUCKET ??
        process.env.AGENTCORE_FILES_BUCKET ??
        (stage ? resolveWorkspaceBucketFromLambda(stage) : null);
      if (!bucket) {
        throw new Error(
          "Workspace bucket is required. Pass --workspace-bucket or set WORKSPACE_BUCKET.",
        );
      }

      const summary = await moveConnectionsToConnectors({
        tenantSlug: opts.tenant,
        agentSlug: opts.agent,
        mode,
        store: new AwsCliWorkspaceObjectStore(bucket),
      });
      console.log(JSON.stringify(summary, null, 2));
      if (summary.agentReports.some((report) => report.status === "failed")) {
        process.exitCode = 1;
      }
      if (mode === "noop-check" && summary.pendingOperations > 0) {
        process.exitCode = 2;
      }
    });
}

function resolveMode(opts: Record<string, unknown>): ConnectorsMoveMode {
  const selected = [
    opts.apply ? "apply" : null,
    opts.noopCheck ? "noop-check" : null,
    opts.dryRun ? "dry-run" : null,
  ].filter(Boolean) as ConnectorsMoveMode[];
  if (selected.length > 1) {
    throw new Error("Choose only one of --dry-run, --apply, or --noop-check.");
  }
  return selected[0] ?? "dry-run";
}
