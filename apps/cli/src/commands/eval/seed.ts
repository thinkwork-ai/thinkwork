import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { SeedEvalTestCasesDoc } from "./gql.js";
import { resolveEvalContext, type EvalCliOptions } from "./helpers.js";

interface SeedOptions extends EvalCliOptions {
  category?: string[];
}

export async function runEvalSeed(opts: SeedOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const data = await gqlMutate(ctx.client, SeedEvalTestCasesDoc, {
    tenantId: ctx.tenantId,
    categories: opts.category && opts.category.length > 0 ? opts.category : null,
  });
  if (isJsonMode()) {
    printJson({ inserted: data.seedEvalTestCases });
    return;
  }
  printSuccess(`Seeded ${data.seedEvalTestCases} new test case(s). (Duplicates were skipped.)`);
}
