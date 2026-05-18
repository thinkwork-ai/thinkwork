import { Command } from "commander";

import { registerEnterpriseBootstrapCommand } from "./enterprise/bootstrap.js";

export function registerEnterpriseCommand(program: Command): void {
  const enterprise = program
    .command("enterprise")
    .description(
      "Bootstrap and operate customer-owned ThinkWork enterprise deployment repositories.",
    );

  registerEnterpriseBootstrapCommand(enterprise);
}
