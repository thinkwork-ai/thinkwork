/**
 * `thinkwork me` — print the current session identity for a stage.
 *
 * Useful as a smoke test after `thinkwork login --stage <s>` and as a
 * scriptable introspection point (`thinkwork me --json | jq .tenantSlug`).
 *
 * Verifies the session works by doing a live `me` GraphQL query. If the
 * query fails we surface the error so the user can tell whether the stack is
 * down, their token expired, or api-key auth is mis-scoped.
 */

import { Command } from "commander";
import { gql } from "@urql/core";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient } from "../lib/gql-client.js";
import { printHeader, printError } from "../ui.js";
import { isJsonMode, printJson, printKeyValue } from "../lib/output.js";

const ME_QUERY = gql`
  query CliMe {
    me {
      id
      email
      name
      tenantId
    }
  }
`;

export function registerMeCommand(program: Command): void {
  program
    .command("me")
    .description(
      "Print the identity behind the current session for a stage. Use after `thinkwork login` to verify everything works, or as a scriptable introspection (`--json | jq`).",
    )
    .option("-s, --stage <name>", "Stage to introspect (defaults to the saved default stage)")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .addHelpText(
      "after",
      `
Examples:
  # Check who you're signed in as on the default stage
  $ thinkwork me

  # Explicit stage
  $ thinkwork me --stage prod

  # Machine-readable — pipe to jq
  $ thinkwork me --stage dev --json | jq .tenantSlug
`,
    )
    .action(async (opts: { stage?: string; region: string }) => {
      const stage = await resolveStage({ flag: opts.stage, region: opts.region });
      const session = loadStageSession(stage);
      if (!session) {
        printError(
          `Not signed in to stage "${stage}". Run \`thinkwork login --stage ${stage}\`.`,
        );
        process.exit(1);
      }

      if (!isJsonMode()) printHeader("me", stage);

      const { client, tenantSlug } = await getGqlClient({ stage, region: opts.region });

      let me: { id: string; email: string; name: string | null; tenantId: string } | null = null;
      try {
        const res = await client.query(ME_QUERY, {}).toPromise();
        if (res.error) throw res.error;
        me = (res.data as any)?.me ?? null;
      } catch (err) {
        printError(
          `me query failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (isJsonMode()) {
        printJson({
          stage,
          mode: session.kind,
          user: me,
          tenant: { id: me?.tenantId, slug: tenantSlug },
        });
        return;
      }

      printKeyValue([
        ["Stage", stage],
        ["Mode", session.kind],
        ["User ID", me?.id],
        ["Email", me?.email ?? (session.kind === "cognito" ? session.email : undefined)],
        ["Name", me?.name ?? undefined],
        ["Tenant ID", me?.tenantId ?? session.tenantId],
        ["Tenant slug", tenantSlug ?? session.tenantSlug],
      ]);
    });
}
