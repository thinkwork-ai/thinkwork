import { runContextSnippetMigrationCli } from "../packages/api/src/lib/context-snippet-migration.js";

runContextSnippetMigrationCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
