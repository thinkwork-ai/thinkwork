import { describe, expect, it } from "vitest";
import {
  AppletImportRewriteError,
  rewriteAppletImports,
} from "../import-shim";

describe("rewriteAppletImports", () => {
  it("rewrites allowed named imports to host registry lookups", () => {
    const result = rewriteAppletImports(
      'import { KpiStrip } from "@thinkwork/computer-stdlib";\nexport { KpiStrip };',
    );

    expect(result).toContain(
      'const KpiStrip = globalThis.__THINKWORK_APPLET_HOST__["@thinkwork/computer-stdlib"].KpiStrip;',
    );
    expect(result).not.toContain("import { KpiStrip }");
  });

  it("rewrites aliases, namespace imports, and the automatic JSX runtime", () => {
    const result = rewriteAppletImports(`
      import { jsx as _jsx } from "react/jsx-runtime";
      import * as UI from "@thinkwork/ui";
      import { useAppletAPI as useAPI } from "useAppletAPI";
      export default UI;
    `);

    expect(result).toContain(
      'const _jsx = globalThis.__THINKWORK_APPLET_HOST__["react/jsx-runtime"].jsx;',
    );
    expect(result).toContain(
      'const UI = globalThis.__THINKWORK_APPLET_HOST__["@thinkwork/ui"];',
    );
    expect(result).toContain(
      "const useAPI = globalThis.__THINKWORK_APPLET_HOST__.useAppletAPI;",
    );
  });

  it("rewrites React imports because saved applet validation allows them", () => {
    const result = rewriteAppletImports(`
      import React, { useMemo as useStableMemo } from "react";
      export default React;
    `);

    expect(result).toContain(
      'const React = globalThis.__THINKWORK_APPLET_HOST__["react"].default ?? globalThis.__THINKWORK_APPLET_HOST__["react"];',
    );
    expect(result).toContain(
      'const useStableMemo = globalThis.__THINKWORK_APPLET_HOST__["react"].useMemo;',
    );
    expect(result).not.toContain('from "react"');
  });

  it("rejects disallowed bare imports with the module name", () => {
    expect(() =>
      rewriteAppletImports('import lodash from "lodash"; export default lodash;'),
    ).toThrow(AppletImportRewriteError);
    expect(() =>
      rewriteAppletImports('import lodash from "lodash"; export default lodash;'),
    ).toThrow(/lodash/);
  });

  it("rejects dynamic imports before runtime", () => {
    expect(() =>
      rewriteAppletImports('export async function load() { return import("lodash"); }'),
    ).toThrow(/lodash/);
  });
});
