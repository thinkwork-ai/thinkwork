import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStageSession, loadStageSession } from "../src/cli-config.js";
import { resolveTenant } from "../src/lib/resolve-tenant.js";

// Sandbox HOME.
let sandbox: string;
let originalHome: string | undefined;
let originalTenantEnv: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "twcli-tenant-"));
  originalHome = process.env.HOME;
  originalTenantEnv = process.env.THINKWORK_TENANT;
  process.env.HOME = sandbox;
  delete process.env.THINKWORK_TENANT;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalTenantEnv !== undefined) process.env.THINKWORK_TENANT = originalTenantEnv;
  else delete process.env.THINKWORK_TENANT;
  rmSync(sandbox, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveTenant precedence", () => {
  it("prefers a --tenant flag", async () => {
    saveStageSession("dev", {
      kind: "api-key",
      authSecret: "s",
      tenantSlug: "cached",
      tenantId: "cache-id",
    });
    const t = await resolveTenant({ stage: "dev", flag: "flag-tenant" });
    expect(t.slug).toBe("flag-tenant");
  });

  it("reuses the cached tenant ID when --tenant matches the cached slug", async () => {
    saveStageSession("dev", {
      kind: "api-key",
      authSecret: "s",
      tenantSlug: "acme",
      tenantId: "tid",
    });
    const t = await resolveTenant({ stage: "dev", flag: "acme" });
    expect(t).toEqual({ slug: "acme", id: "tid" });
  });

  it("falls back to THINKWORK_TENANT env var", async () => {
    process.env.THINKWORK_TENANT = "from-env";
    const t = await resolveTenant({ stage: "dev" });
    expect(t.slug).toBe("from-env");
  });

  it("returns the cached session tenant when no flag/env", async () => {
    saveStageSession("dev", {
      kind: "api-key",
      authSecret: "s",
      tenantSlug: "cached",
      tenantId: "cid",
    });
    const t = await resolveTenant({ stage: "dev" });
    expect(t).toEqual({ slug: "cached", id: "cid" });
  });

  it("exits when nothing is resolvable and no listTenants supplied", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveTenant({ stage: "dev" }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("auto-selects the only available tenant and caches it on the session", async () => {
    saveStageSession("dev", { kind: "api-key", authSecret: "s" });
    const t = await resolveTenant({
      stage: "dev",
      listTenants: async () => [
        { id: "only-id", slug: "only", name: "The Only Tenant" },
      ],
    });
    expect(t).toEqual({ slug: "only", id: "only-id" });
    // Cache was written back.
    const session = loadStageSession("dev");
    expect(session?.tenantSlug).toBe("only");
    expect(session?.tenantId).toBe("only-id");
  });

  it("exits when listTenants returns no tenants", async () => {
    saveStageSession("dev", { kind: "api-key", authSecret: "s" });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveTenant({
      stage: "dev",
      listTenants: async () => [],
    }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
