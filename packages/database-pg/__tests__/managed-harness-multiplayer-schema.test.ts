import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  harnessDisclosureDecisions,
  harnessGovernedToolExecutions,
  harnessManagedThreadEnrollments,
  harnessParticipantSessions,
  threadPublicEvents,
} from "../src/schema/harness-multiplayer";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0261_managed_harness_multiplayer.sql"),
  "utf8",
);
const parallelThreadsMigration = readFileSync(
  join(HERE, "..", "drizzle", "0262_parallel_harness_threads.sql"),
  "utf8",
);

describe("managed multiplayer Harness schema", () => {
  it("pins the proof to fresh-per-turn sessions", () => {
    expect(getTableColumns(harnessManagedThreadEnrollments)).toHaveProperty(
      "session_strategy",
    );
    expect(getTableColumns(harnessParticipantSessions)).toMatchObject({
      turn_id: expect.anything(),
      runtime_session_id: expect.anything(),
      captured_high_water: expect.anything(),
      applied_high_water: expect.anything(),
    });
    expect(migration).toContain("CHECK (session_strategy = 'fresh')");
    expect(migration).toContain("CHECK (generation = 1)");
    expect(migration).not.toContain("ready','running");
  });

  it("allows multiple normal threads to share one tenant Harness", () => {
    expect(parallelThreadsMigration).toContain(
      "DROP INDEX IF EXISTS public.uq_harness_enrollment_active_profile",
    );
    expect(parallelThreadsMigration).toContain(
      "CREATE INDEX IF NOT EXISTS idx_harness_enrollment_active_profile",
    );
    expect(parallelThreadsMigration).not.toContain("CREATE UNIQUE INDEX");
  });

  it("keeps the ordered event ledger content-free", () => {
    const columns = getTableColumns(threadPublicEvents);
    expect(columns).toHaveProperty("canonical_digest");
    expect(columns).not.toHaveProperty("content");
    expect(columns).not.toHaveProperty("parts");
    expect(migration).toContain("id bigserial PRIMARY KEY");
    expect(migration).toContain(
      "UNIQUE (tenant_id, thread_id, source_kind, source_id, source_version)",
    );
  });

  it("admits only enrolled public message/artifact events", () => {
    expect(migration).toContain(
      "CREATE TRIGGER trg_capture_harness_message_public_event",
    );
    expect(migration).toContain("NEW.role IN ('user', 'assistant')");
    expect(migration).toContain(
      "coalesce(NEW.metadata->>'disclosure_status', 'published') NOT IN ('withheld', 'confirmation_required')",
    );
    expect(migration).toContain("version_value := 'invalidate:update:'");
    expect(migration).toMatch(
      /IF admitted_before THEN[\s\S]*?'invalidate'[\s\S]*?IF NOT admitted_now THEN/,
    );
    expect(migration).toContain(
      "CREATE TRIGGER trg_capture_harness_artifact_public_event",
    );
    expect(migration).toContain(
      "AFTER INSERT OR UPDATE OR DELETE ON public.message_artifacts",
    );
    expect(migration).toContain(
      "creates-function: public.capture_harness_message_public_event",
    );
    expect(migration).toContain(
      "creates-trigger: public.message_artifacts.trg_capture_harness_artifact_public_event",
    );
  });

  it("stores only sanitized governed results and non-resumable decisions", () => {
    const toolColumns = getTableColumns(harnessGovernedToolExecutions);
    const decisionColumns = getTableColumns(harnessDisclosureDecisions);
    expect(toolColumns).toHaveProperty("sanitized_result");
    expect(toolColumns).not.toHaveProperty("credential");
    expect(decisionColumns).toHaveProperty("projection_digest");
    expect(decisionColumns).not.toHaveProperty("withheld_value");
    expect(decisionColumns).not.toHaveProperty("retrieval_pointer");
  });
});
