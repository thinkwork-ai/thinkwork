/**
 * Validate and record the machine-readable native-auth cutover evidence that
 * gates migration 0263. Dry-run is the default; --apply marks the matching
 * inventory complete only when every zero/boolean predicate is exact.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { authCutoverRuns } from "@thinkwork/database-pg/schema";
import { db } from "../src/lib/db.js";

const SHA256_RE = /^[a-f0-9]{64}$/;

export interface AuthCutoverCompletionEvidence {
  inventoryFingerprint: string;
  terminalDispositions: {
    allTerminal: true;
    unresolved: 0;
    signoutFailures: 0;
    compatibilityFallbackReads: 0;
  };
  clientShutdownEvidence: {
    workosStartsEnabled: false;
    legacyClientsEnabled: 0;
    legacyAudiencesAccepted: 0;
  };
  drainEvidence: {
    drainCompleted: true;
    legacyRouteTraffic: 0;
    workosTableReads: 0;
    workosTableWrites: 0;
    activeLegacySubscriptions: 0;
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${path} must contain exactly: ${expected.join(", ")}`);
  }
}

export function parseAuthCutoverCompletionEvidence(
  input: unknown,
): AuthCutoverCompletionEvidence {
  const root = record(input, "evidence");
  exactKeys(
    root,
    [
      "inventoryFingerprint",
      "terminalDispositions",
      "clientShutdownEvidence",
      "drainEvidence",
    ],
    "evidence",
  );
  if (
    typeof root.inventoryFingerprint !== "string" ||
    !SHA256_RE.test(root.inventoryFingerprint)
  ) {
    throw new Error("evidence.inventoryFingerprint must be a SHA-256 digest");
  }
  const terminal = record(
    root.terminalDispositions,
    "evidence.terminalDispositions",
  );
  exactKeys(
    terminal,
    [
      "allTerminal",
      "unresolved",
      "signoutFailures",
      "compatibilityFallbackReads",
    ],
    "evidence.terminalDispositions",
  );
  const clients = record(
    root.clientShutdownEvidence,
    "evidence.clientShutdownEvidence",
  );
  exactKeys(
    clients,
    ["workosStartsEnabled", "legacyClientsEnabled", "legacyAudiencesAccepted"],
    "evidence.clientShutdownEvidence",
  );
  const drain = record(root.drainEvidence, "evidence.drainEvidence");
  exactKeys(
    drain,
    [
      "drainCompleted",
      "legacyRouteTraffic",
      "workosTableReads",
      "workosTableWrites",
      "activeLegacySubscriptions",
    ],
    "evidence.drainEvidence",
  );
  const predicates: Array<[unknown, unknown, string]> = [
    [terminal.allTerminal, true, "terminalDispositions.allTerminal"],
    [terminal.unresolved, 0, "terminalDispositions.unresolved"],
    [terminal.signoutFailures, 0, "terminalDispositions.signoutFailures"],
    [
      terminal.compatibilityFallbackReads,
      0,
      "terminalDispositions.compatibilityFallbackReads",
    ],
    [
      clients.workosStartsEnabled,
      false,
      "clientShutdownEvidence.workosStartsEnabled",
    ],
    [
      clients.legacyClientsEnabled,
      0,
      "clientShutdownEvidence.legacyClientsEnabled",
    ],
    [
      clients.legacyAudiencesAccepted,
      0,
      "clientShutdownEvidence.legacyAudiencesAccepted",
    ],
    [drain.drainCompleted, true, "drainEvidence.drainCompleted"],
    [drain.legacyRouteTraffic, 0, "drainEvidence.legacyRouteTraffic"],
    [drain.workosTableReads, 0, "drainEvidence.workosTableReads"],
    [drain.workosTableWrites, 0, "drainEvidence.workosTableWrites"],
    [
      drain.activeLegacySubscriptions,
      0,
      "drainEvidence.activeLegacySubscriptions",
    ],
  ];
  for (const [actual, expected, path] of predicates) {
    if (actual !== expected) {
      throw new Error(`${path} must equal ${String(expected)}`);
    }
  }
  return input as AuthCutoverCompletionEvidence;
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const evidencePath = option("--evidence");
  const stage = process.env.THINKWORK_STAGE;
  if (!evidencePath || !stage) {
    throw new Error("--evidence <path> and THINKWORK_STAGE are required");
  }
  const evidence = parseAuthCutoverCompletionEvidence(
    JSON.parse(readFileSync(evidencePath, "utf8")) as unknown,
  );
  const apply = process.argv.includes("--apply");
  if (apply) {
    const rows = await db
      .update(authCutoverRuns)
      .set({
        status: "complete",
        terminal_dispositions: evidence.terminalDispositions,
        client_shutdown_evidence: evidence.clientShutdownEvidence,
        drain_evidence: evidence.drainEvidence,
        completed_at: new Date(),
      })
      .where(
        and(
          eq(authCutoverRuns.stage, stage),
          eq(
            authCutoverRuns.inventory_fingerprint,
            evidence.inventoryFingerprint,
          ),
        ),
      )
      .returning({ id: authCutoverRuns.id });
    if (rows.length !== 1) {
      throw new Error(
        "exactly one matching auth cutover inventory is required",
      );
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      stage,
      inventoryFingerprint: evidence.inventoryFingerprint,
      gates: "complete",
    })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`Auth cutover finalization failed: ${message}\n`);
    process.exitCode = 1;
  });
}
