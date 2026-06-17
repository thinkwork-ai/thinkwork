import type { NormalizedProviderEvent } from "./provider-contract.js";
import { recordProviderEvent } from "./ledger.js";

export async function recordInboundProviderEvent(input: {
  db: any;
  tenantId: string;
  providerInstallId: string;
  event: NormalizedProviderEvent;
}): Promise<{ duplicate: boolean; ledgerEventId: string | null }> {
  const result = await recordProviderEvent(input);
  return { duplicate: !result.recorded, ledgerEventId: result.ledgerEventId };
}
