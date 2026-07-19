import { Command } from "commander";

import { registerEnterpriseBootstrapCommand } from "./enterprise/bootstrap.js";
import { registerEnterpriseAuthRecoveryCommand } from "./enterprise/auth-recovery.js";
import { registerEnterpriseIdentityProviderCommand } from "./enterprise/identity-provider-command.js";
import { registerEnterpriseOverlayCommand } from "./enterprise/overlay.js";

export function registerEnterpriseCommand(program: Command): void {
  const enterprise = program
    .command("enterprise")
    .description(
      "Low-level customer-owned enterprise deployment repo operations. Normal deploys use `thinkwork deploy --bootstrap`.",
    );

  registerEnterpriseBootstrapCommand(enterprise);
  registerEnterpriseAuthRecoveryCommand(enterprise);
  registerEnterpriseIdentityProviderCommand(enterprise);
  registerEnterpriseOverlayCommand(enterprise);
}
