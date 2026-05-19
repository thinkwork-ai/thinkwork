import { Command } from "commander";

import { registerEnterpriseBootstrapCommand } from "./enterprise/bootstrap.js";
import { registerEnterpriseOverlayCommand } from "./enterprise/overlay.js";

export function registerEnterpriseCommand(program: Command): void {
  const enterprise = program
    .command("enterprise")
    .description(
      "Low-level customer-owned enterprise deployment repo operations. Normal deploys use `thinkwork deploy --bootstrap`.",
    );

  registerEnterpriseBootstrapCommand(enterprise);
  registerEnterpriseOverlayCommand(enterprise);
}
