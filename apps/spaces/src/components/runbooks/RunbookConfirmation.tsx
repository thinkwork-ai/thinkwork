"use client";

import type { RunbookConfirmationData } from "@/lib/ui-message-types";

export interface RunbookConfirmationProps {
  data: RunbookConfirmationData;
  onConfirm?: (runbookRunId: string) => Promise<void> | void;
  onReject?: (runbookRunId: string) => Promise<void> | void;
}

/**
 * Runbook confirmation UI is inert after the runbook orchestration substrate
 * was removed. The component renders nothing so existing chat-message parts
 * that reference it stay parseable while the new substrate is designed.
 */
export function RunbookConfirmation(_props: RunbookConfirmationProps) {
  return null;
}
