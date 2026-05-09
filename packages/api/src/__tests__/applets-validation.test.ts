import { describe, expect, it } from "vitest";
import {
  AppletImportError,
  AppletRuntimePatternError,
  AppletSyntaxError,
  validateAppletSource,
} from "../lib/applets/validation.js";

describe("applet source validation", () => {
  it("accepts React applets that import the stdlib", () => {
    expect(
      validateAppletSource(`
        import React from "react";
        import { AppHeader } from "@thinkwork/computer-stdlib";

        export default function Applet() {
          return <AppHeader title="Pipeline" />;
        }
      `),
    ).toEqual({ ok: true });
  });

  it("rejects imports outside the contract allowlist", () => {
    expect(() =>
      validateAppletSource(`
        import { readFileSync } from "node:fs";
        export default function Applet() { return readFileSync; }
      `),
    ).toThrow(AppletImportError);
  });

  it("rejects dynamic imports outside the contract allowlist", () => {
    expect(() =>
      validateAppletSource(`
        export default async function Applet() {
          return import("lodash");
        }
      `),
    ).toThrow(AppletImportError);
  });

  it("rejects forbidden runtime patterns and reports the source line", () => {
    try {
      validateAppletSource(`
        export default function Applet() {
          const fetchOpportunities = [];
          return fetchOpportunities.length;
        }
      `);
      throw new Error("expected validation to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(AppletRuntimePatternError);
      expect((err as AppletRuntimePatternError).pattern).toBe("\\bfetch\\b");
      expect((err as AppletRuntimePatternError).line).toBe(3);
    }
  });

  it("rejects invalid TSX syntax", () => {
    expect(() =>
      validateAppletSource(`
        export default function Applet() {
          return <div>;
        }
      `),
    ).toThrow(AppletSyntaxError);
  });
});
