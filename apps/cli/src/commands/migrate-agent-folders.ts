import { execFileSync } from "node:child_process";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { Command } from "commander";
import { loadDefaults } from "@thinkwork/workspace-defaults";
import {
  migrateAgentFolders,
  type AgentFolderMode,
} from "../lib/migrations/agent-folder-migrator.js";
import { AwsCliWorkspaceObjectStore } from "./migrate-folder-canon.js";

export function registerMigrateAgentFoldersCommand(program: Command): void {
  program
    .command("migrate-agent-folders")
    .description(
      "Materialize built-in sub-agent folders, convert legacy agents/<slug>.md profile files to the folder form (subagent-folders U8), and copy the root AGENTS.md to INSTRUCTIONS.md byte-identically (U16 rename; AGENTS.md is left in place for the fallback window). The sweep preserves legacy files.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug to migrate")
    .option("--agent <slug>", "Limit to one agent slug under the tenant")
    .option("--workspace-bucket <bucket>", "Workspace S3 bucket override")
    .option(
      "--signing-key-secret <name>",
      "Secrets Manager secret holding the capability signing key (default thinkwork/<stage>/capability-signing-key)",
    )
    .option("--dry-run", "Read and report planned writes without mutating")
    .option("--apply", "Apply writes")
    .action(async (opts, cmd) => {
      const parent = cmd.parent as Command | undefined;
      const stage = opts.stage ?? parent?.opts().stage;
      const mode: AgentFolderMode = opts.apply ? "apply" : "dry-run";
      const bucket =
        opts.workspaceBucket ??
        process.env.WORKSPACE_BUCKET ??
        (stage ? resolveWorkspaceBucketFromLambda(stage) : null);
      if (!bucket) {
        throw new Error(
          "Workspace bucket is required. Pass --workspace-bucket or set WORKSPACE_BUCKET.",
        );
      }
      const signingKey = resolveSigningKey(
        opts.signingKeySecret ??
          (stage ? `thinkwork/${stage}/capability-signing-key` : null),
      );
      if (!signingKey) {
        console.warn(
          "[migrate-agent-folders] signing key unavailable — grant sidecars will be skipped and flagged",
        );
      }

      const builtInFolders = Object.fromEntries(
        Object.entries(loadDefaults()).filter(([path]) =>
          path.startsWith("agents/"),
        ),
      );

      const summary = await migrateAgentFolders({
        tenantSlug: opts.tenant,
        agentSlug: opts.agent,
        mode,
        store: new AwsCliWorkspaceObjectStore(bucket),
        signingKey,
        builtInFolders,
      });
      console.log(JSON.stringify(summary, null, 2));
      if (summary.reports.some((report) => report.status === "failed")) {
        process.exitCode = 1;
      }
    });
}

function resolveSigningKey(secretName: string | null): KeyObject | null {
  if (!secretName) return null;
  try {
    const pem = execFileSync(
      "aws",
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        secretName,
        "--query",
        "SecretString",
        "--output",
        "text",
      ],
      { encoding: "utf8" },
    ).trim();
    if (!pem || pem === "None") return null;
    return createPrivateKey(pem);
  } catch {
    return null;
  }
}

function resolveWorkspaceBucketFromLambda(stage: string): string | null {
  for (const functionName of [
    `thinkwork-${stage}-api-workspace-files`,
    `thinkwork-${stage}-api-graphql-http`,
    `thinkwork-${stage}-api-tenants`,
  ]) {
    try {
      const value = execFileSync(
        "aws",
        [
          "lambda",
          "get-function-configuration",
          "--function-name",
          functionName,
          "--query",
          "Environment.Variables.WORKSPACE_BUCKET",
          "--output",
          "text",
        ],
        { encoding: "utf8" },
      ).trim();
      if (value && value !== "None") return value;
    } catch {
      // Try the next common Lambda name.
    }
  }
  return null;
}
