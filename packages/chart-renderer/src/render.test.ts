/**
 * Gate 1: with options omitted, `renderChart` must be byte-identical to the
 * pre-extraction server renderer. The goldens under `__fixtures__/golden/`
 * were captured from `packages/api/src/lib/artifacts/document-charts.ts` at
 * the commit BEFORE this package existed, so any drift fails here.
 *
 * Gate 2: non-default frames (narrow width, scaled type, resolved palette)
 * are deterministic — checked-in goldens pin the reflow arithmetic.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./__fixtures__/corpus.js";
import { HOUSE_DARK } from "./palette.js";
import { renderChart } from "./render.js";
import { CHART_TYPES } from "./types.js";

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "golden",
);

function golden(name: string): string {
  return readFileSync(join(GOLDEN_DIR, `${name}.svg`), "utf8");
}

/** Every fixture kind is exercised — no chart type ships unguarded. */
describe("fixture corpus", () => {
  it("covers all seven chart kinds", () => {
    const covered = new Set(FIXTURES.map((f) => f.data.type));
    expect([...covered].sort()).toEqual([...CHART_TYPES].sort());
  });
});

describe("Gate 1: default options are byte-identical to the server renderer", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name} matches its golden`, () => {
      expect(renderChart(fixture.data)).toBe(golden(fixture.name));
    });
  }

  it("explicit defaults render the same as omitted options", () => {
    for (const fixture of FIXTURES) {
      expect(renderChart(fixture.data, { width: 720, fontScale: 1 })).toBe(
        renderChart(fixture.data),
      );
    }
  });
});

/** Representative subset at a phone frame, unscaled and at Dynamic Type. */
const REFLOW_CASES = [
  "funnel-typical",
  "bar-typical",
  "donut-six-segments",
  "stat-strip-typical",
] as const;

describe("Gate 2: narrow frames reflow deterministically", () => {
  for (const name of REFLOW_CASES) {
    const fixture = FIXTURES.find((f) => f.name === name);
    if (!fixture) throw new Error(`missing fixture ${name}`);
    for (const fontScale of [1, 1.3]) {
      const key = `${name}-w360-fs${String(fontScale).replace(".", "_")}-dark`;
      it(`${key} matches its golden`, () => {
        expect(
          renderChart(fixture.data, {
            width: 360,
            fontScale,
            palette: HOUSE_DARK,
          }),
        ).toBe(golden(key));
      });
    }
  }

  it("is stable across repeated renders", () => {
    const fixture = FIXTURES[0];
    const once = renderChart(fixture.data, { width: 360, fontScale: 1.3 });
    expect(renderChart(fixture.data, { width: 360, fontScale: 1.3 })).toBe(
      once,
    );
  });
});

describe("SECURITY: model-authored strings are escaped at the boundary", () => {
  it("escapes labels, titles and qualifiers", () => {
    const svg = renderChart({
      type: "bar",
      title: '</svg><script>alert("x")</script>',
      qualifier: "a & b <c>",
      series: [{ label: "<img src=x onerror=alert(1)>", value: 5 }],
    });
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<img");
    expect(svg).toMatch(/&(amp|lt|gt|quot|#39);/);
    expect(svg).not.toMatch(/&(?!(amp|lt|gt|quot|#39);)/);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});

describe("axis ticks compress at dollar scale", () => {
  it("renders M/K tick labels instead of clipped full-precision numbers", () => {
    const svg = renderChart({
      type: "bar",
      title: "Top branches",
      series: [
        { label: "A", value: 28_706_613 },
        { label: "B", value: 12_040_000 },
      ],
    });
    expect(svg).toMatch(/>\d+(\.\d+)?M</);
    expect(svg).not.toContain(">28,000,000<");
    // the extreme value label above the bar keeps full precision
    expect(svg).toContain("28,706,613");
  });

  it("keeps small-scale ticks in full precision", () => {
    const svg = renderChart({
      type: "bar",
      title: "Counts",
      series: [{ label: "A", value: 6155 }],
    });
    expect(svg).not.toMatch(/>\d+(\.\d+)?[MK]</);
  });
});
