import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppletTransformCache } from "../cache";
import { compileAppletSource, transformApplet } from "../transform";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transformApplet", () => {
  it("compiles TSX to an importable module URL", async () => {
    const source = `
      import { jsx as jsxRuntime } from "react/jsx-runtime";
      import { KpiStrip } from "@thinkwork/computer-stdlib";

      export const marker = KpiStrip ? "stdlib-present" : "missing";
      export default function App() {
        return <section>hello</section>;
      }
    `;

    globalThis.__THINKWORK_APPLET_HOST__ = {
      "react/jsx-runtime": { jsx: () => ({}) },
      "@thinkwork/computer-stdlib": { KpiStrip: function KpiStrip() {} },
    } as unknown as typeof globalThis.__THINKWORK_APPLET_HOST__;

    const result = await transformApplet(source, 1, {
      cache: new AppletTransformCache(),
      useWorker: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const module = (await import(result.compiledModuleUrl)) as {
      marker: string;
      default: unknown;
    };

    expect(module.marker).toBe("stdlib-present");
    expect(typeof module.default).toBe("function");
  });

  it("uses the cache on repeated transforms", async () => {
    const createObjectURL = vi.fn(() => "blob:compiled");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    const cache = new AppletTransformCache();
    const source = "export default function App() { return null; }";

    const first = await transformApplet(source, 1, { cache, useWorker: false });
    const second = await transformApplet(source, 1, {
      cache,
      useWorker: false,
    });

    expect(first).toMatchObject({ ok: true, cached: false });
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("returns a parse error for malformed TSX", () => {
    const result = compileAppletSource(
      "export default function App() { return <section>; }",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected transform failure");
    expect(result.error.message).toMatch(/Unexpected token|Expected/i);
  });

  it("rejects disallowed imports after the TSX transform", () => {
    const result = compileAppletSource(
      'import lodash from "lodash"; export default function App() { return <div />; }',
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected transform failure");
    expect(result.error.message).toContain("lodash");
  });

  it("compiles the migrated CRM pipeline-risk applet source", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/test/fixtures/crm-pipeline-risk-applet/source.tsx",
      ),
      "utf8",
    );
    const result = compileAppletSource(source);

    expect(source).not.toMatch(/\bfetch\w*/);
    expect(result.ok).toBe(true);
  });
});
