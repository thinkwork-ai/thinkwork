import { describe, expect, it } from "vitest";
import { AppletImportRewriteError, rewriteAppletImports } from "../import-shim";

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

  it("rewrites aliases and the automatic JSX runtime", () => {
    const result = rewriteAppletImports(`
      import { jsx as _jsx } from "react/jsx-runtime";
      import { Card } from "@thinkwork/ui";
      import { useAppletAPI as useAPI } from "useAppletAPI";
      export default Card;
    `);

    expect(result).toContain(
      'const _jsx = globalThis.__THINKWORK_APPLET_HOST__["react/jsx-runtime"].jsx;',
    );
    expect(result).toContain(
      'const Card = globalThis.__THINKWORK_APPLET_HOST__["@thinkwork/ui"].Card;',
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

  it("rewrites Recharts imports that save validation allows through ChartContainer", () => {
    const result = rewriteAppletImports(`
      import { BarChart } from "recharts";
      export { BarChart };
    `);

    expect(result).toContain(
      'const BarChart = globalThis.__THINKWORK_APPLET_HOST__["recharts"].BarChart;',
    );
  });

  it("rewrites the approved host map component", () => {
    const result = rewriteAppletImports(`
      import { MapView } from "@thinkwork/computer-stdlib";
      export { MapView };
    `);

    expect(result).toContain(
      'const MapView = globalThis.__THINKWORK_APPLET_HOST__["@thinkwork/computer-stdlib"].MapView;',
    );
  });

  it("rejects lucide, raw map libraries, namespace imports, and unknown UI exports", () => {
    expect(() =>
      rewriteAppletImports('import { ShieldCheck } from "lucide-react";'),
    ).toThrow(/lucide-react/);
    expect(() =>
      rewriteAppletImports('import { MapContainer } from "react-leaflet";'),
    ).toThrow(/react-leaflet/);
    expect(() =>
      rewriteAppletImports('import * as UI from "@thinkwork/ui";'),
    ).toThrow(/Namespace imports/);
    expect(() =>
      rewriteAppletImports('import { Calendar } from "@thinkwork/ui";'),
    ).toThrow(/Calendar/);
  });

  it("rejects disallowed bare imports with the module name", () => {
    expect(() =>
      rewriteAppletImports(
        'import lodash from "lodash"; export default lodash;',
      ),
    ).toThrow(AppletImportRewriteError);
    expect(() =>
      rewriteAppletImports(
        'import lodash from "lodash"; export default lodash;',
      ),
    ).toThrow(/lodash/);
  });

  it("rejects dynamic imports before runtime", () => {
    expect(() =>
      rewriteAppletImports(
        'export async function load() { return import("lodash"); }',
      ),
    ).toThrow(/lodash/);
  });
});
