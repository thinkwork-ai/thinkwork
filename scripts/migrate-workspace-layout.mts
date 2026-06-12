import { runWorkspaceLayoutMigrationCli } from "../packages/api/src/lib/workspace-layout-migration.js";

runWorkspaceLayoutMigrationCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
