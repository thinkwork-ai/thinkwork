import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  evaluateEtlCheckout,
  evaluateTenantResolution,
  probeEtlCheckout,
} from "../src/lib/twin-install-checks.js";

describe("evaluateEtlCheckout", () => {
  it("fails with guidance when no path is configured", () => {
    const r = evaluateEtlCheckout({
      path: null,
      dirExists: false,
      isEtlRepo: false,
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/--etl-repo-dir/);
    expect(r.detail).toMatch(/THINKWORK_ETL_REPO/);
    expect(r.detail).toMatch(/thinkwork-ai\/company-brain/);
  });

  it("fails naming the missing dir", () => {
    const r = evaluateEtlCheckout({
      path: "/nope/etl",
      dirExists: false,
      isEtlRepo: false,
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("/nope/etl");
  });

  it("fails when the dir is not the etl repo", () => {
    const r = evaluateEtlCheckout({
      path: "/tmp/other-repo",
      dirExists: true,
      isEtlRepo: false,
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/etl-platform/);
    expect(r.detail).toMatch(/thinkwork-ai\/company-brain/);
  });

  it("passes on a valid checkout", () => {
    const r = evaluateEtlCheckout({
      path: "/home/me/etl",
      dirExists: true,
      isEtlRepo: true,
    });
    expect(r.pass).toBe(true);
    expect(r.detail).toContain("/home/me/etl");
  });
});

describe("etl checkout dual-accept during transition (U8, KTD-10)", () => {
  // Identity is established by the marker layout (etl-platform/), never the
  // git remote — so a company-brain checkout and an old-repo checkout are
  // indistinguishable and both accepted; unrelated repos lack the marker.
  const mkRepo = (withMarker: boolean): string => {
    const dir = mkdtempSync(join(tmpdir(), "etl-checkout-"));
    if (withMarker) mkdirSync(join(dir, "etl-platform"));
    return dir;
  };

  it("accepts a thinkwork-ai/company-brain checkout", () => {
    const dir = mkRepo(true);
    try {
      const r = evaluateEtlCheckout(probeEtlCheckout(dir));
      expect(r.pass).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts an old McPherson-Data/thinkwork checkout (transition window)", () => {
    const dir = mkRepo(true);
    try {
      const r = evaluateEtlCheckout(probeEtlCheckout(dir));
      expect(r.pass).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unrelated repo without the etl-platform marker", () => {
    const dir = mkRepo(false);
    try {
      const r = evaluateEtlCheckout(probeEtlCheckout(dir));
      expect(r.pass).toBe(false);
      expect(r.detail).toMatch(/etl-platform/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("evaluateTenantResolution (KTD-5)", () => {
  it("infers the tenant on a single-tenant stage", () => {
    const r = evaluateTenantResolution(["tei"], undefined);
    expect(r.tenant).toBe("tei");
    expect(r.result.pass).toBe(true);
  });

  it("fails with the ambiguity message on a multi-tenant stage without --tenant", () => {
    const r = evaluateTenantResolution(["tei", "mcpherson"], undefined);
    expect(r.tenant).toBeNull();
    expect(r.result.pass).toBe(false);
    expect(r.result.detail).toMatch(/--tenant/);
    expect(r.result.detail).toContain("tei");
    expect(r.result.detail).toContain("mcpherson");
  });

  it("explicit --tenant always wins", () => {
    const r = evaluateTenantResolution(["tei", "mcpherson"], "mcpherson");
    expect(r.tenant).toBe("mcpherson");
    expect(r.result.pass).toBe(true);
  });

  it("explicit --tenant not on the stage fails", () => {
    const r = evaluateTenantResolution(["tei"], "acme");
    expect(r.tenant).toBeNull();
    expect(r.result.pass).toBe(false);
    expect(r.result.detail).toContain("acme");
  });

  it("empty tenant list fails", () => {
    const r = evaluateTenantResolution([], undefined);
    expect(r.tenant).toBeNull();
    expect(r.result.pass).toBe(false);
  });
});
