import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dryRunComputerMigration: vi.fn(),
  applyComputerMigration: vi.fn(),
  ComputerMigrationBlockedError: class ComputerMigrationBlockedError extends Error {
    readonly statusCode = 409;

    constructor(
      message: string,
      readonly blockers: unknown[],
    ) {
      super(message);
      this.name = "ComputerMigrationBlockedError";
    }
  },
}));

vi.mock("../lib/computers/migration.js", () => ({
  dryRunComputerMigration: mocks.dryRunComputerMigration,
  applyComputerMigration: mocks.applyComputerMigration,
  ComputerMigrationBlockedError: mocks.ComputerMigrationBlockedError,
}));

import { handler } from "./migrate-agents-to-computers.js";

const TENANT_ID = "11111111-2222-4333-8444-555555555555";

function event(body: Record<string, unknown>, auth = "Bearer test-secret") {
  return {
    headers: { authorization: auth },
    body: JSON.stringify(body),
    requestContext: { http: { method: "POST" } },
  };
}

describe("migrate-agents-to-computers handler", () => {
  beforeEach(() => {
    process.env.API_AUTH_SECRET = "test-secret";
    mocks.dryRunComputerMigration.mockReset();
    mocks.applyComputerMigration.mockReset();
    mocks.dryRunComputerMigration.mockResolvedValue({
      tenantId: TENANT_ID,
      dryRun: true,
      summary: { ready: 1 },
      groups: [],
    });
    mocks.applyComputerMigration.mockResolvedValue({
      report: { tenantId: TENANT_ID, dryRun: false, summary: {}, groups: [] },
      created: ["computer-1"],
      skipped: [],
    });
  });

  it("requires service auth", async () => {
    const response = await handler(
      event({ tenantId: TENANT_ID }, "Bearer bad"),
    );
    expect(response.statusCode).toBe(401);
    expect(mocks.dryRunComputerMigration).not.toHaveBeenCalled();
  });

  it("validates tenant ID and mode before executing migration work", async () => {
    const badTenant = await handler(event({ tenantId: "tenant-1" }));
    expect(badTenant.statusCode).toBe(400);
    expect(JSON.parse(badTenant.body).error).toMatch(/UUID/);

    const badMode = await handler(
      event({ tenantId: TENANT_ID, mode: "explode" }),
    );
    expect(badMode.statusCode).toBe(400);
    expect(JSON.parse(badMode.body).error).toMatch(/mode/);
  });

  it("runs dry-run mode by default", async () => {
    const response = await handler(event({ tenantId: TENANT_ID }));
    expect(response.statusCode).toBe(200);
    expect(mocks.dryRunComputerMigration).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
    });
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      mode: "dry-run",
      report: { tenantId: TENANT_ID, dryRun: true },
    });
  });

  it("runs apply mode and returns created/skipped IDs", async () => {
    const response = await handler(
      event({
        tenantId: TENANT_ID,
        mode: "apply",
        idempotencyKey: "migration-2026-05-06",
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.applyComputerMigration).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      apply: true,
    });
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      mode: "apply",
      idempotencyKey: "migration-2026-05-06",
      created: ["computer-1"],
    });
  });

  it("returns structured blockers as 409", async () => {
    mocks.applyComputerMigration.mockRejectedValue(
      new mocks.ComputerMigrationBlockedError("blocked", [
        { status: "multiple_candidates" },
      ]),
    );

    const response = await handler(
      event({ tenantId: TENANT_ID, mode: "apply" }),
    );
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      error: "blocked",
      blockers: [{ status: "multiple_candidates" }],
    });
  });
});
