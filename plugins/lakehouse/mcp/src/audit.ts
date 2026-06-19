import { createHash } from "node:crypto";
import type { AuditEvent } from "./types";

export function createAuditEvent(
  input: Omit<AuditEvent, "auditId">,
): AuditEvent {
  const auditId = createHash("sha256")
    .update(
      [
        input.actor,
        input.tool,
        input.integrationKey,
        input.bundleVersion,
        input.createdAt,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);
  return { auditId, ...input };
}
