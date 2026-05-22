import { describe, expect, it } from "vitest";
import {
  AppletSourcePolicyError,
  validateGeneratedAppSourcePolicy,
} from "./source-policy.js";

describe("generated app source policy", () => {
  it("rejects namespace imports because they bypass export allowlists", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import * as UI from "@thinkwork/ui";
        export default function Applet() { return <UI.Card />; }
      `),
    ).toThrow(AppletSourcePolicyError);
  });

  it("rejects aliased Recharts primitives outside ChartContainer", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { Card, ChartContainer } from "@thinkwork/ui";
        import { LineChart as TrendChart } from "recharts";
        export default function Applet() {
          return (
            <Card>
              <ChartContainer config={{ value: { label: "Value" } }} />
              <TrendChart data={[]} />
            </Card>
          );
        }
      `),
    ).toThrow(/TrendChart must be nested inside ChartContainer/);
  });

  // Regression: a saved crm-dashboard app on 2026-05-22 rendered every Bar
  // as solid black because the agent emitted className="fill-primary"
  // (resolves to the single primary color, not the chart palette). The
  // skill already told the agent to use chart vars; the validator must
  // enforce it server-side so future bad saves are rejected at the gate.
  it("rejects semantic fill-* classes on Recharts Bar marks", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { ChartContainer } from "@thinkwork/ui";
        import { Bar, BarChart } from "recharts";
        export default function Applet() {
          return (
            <ChartContainer config={{}}>
              <BarChart data={[]}>
                <Bar dataKey="value" className="fill-primary" />
              </BarChart>
            </ChartContainer>
          );
        }
      `),
    ).toThrow(/Bar uses className="fill-primary"/);
  });

  it("rejects semantic fill-* classes on Recharts Cell marks", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { ChartContainer } from "@thinkwork/ui";
        import { Cell, Pie, PieChart } from "recharts";
        export default function Applet() {
          return (
            <ChartContainer config={{}}>
              <PieChart>
                <Pie data={[]} dataKey="value">
                  <Cell className="fill-destructive" />
                </Pie>
              </PieChart>
            </ChartContainer>
          );
        }
      `),
    ).toThrow(/Cell uses className="fill-destructive"/);
  });

  it("rejects semantic fill-* even when composed with other utility classes", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { ChartContainer } from "@thinkwork/ui";
        import { Line, LineChart } from "recharts";
        export default function Applet() {
          return (
            <ChartContainer config={{}}>
              <LineChart data={[]}>
                <Line dataKey="y" className="stroke-1 fill-foreground" />
              </LineChart>
            </ChartContainer>
          );
        }
      `),
    ).toThrow(/Line uses className="fill-foreground"/);
  });

  // Regression: the original naive `[^>]*?` regex span between tag name and
  // className stopped at any literal `>` — including the `>` in `=>` inside a
  // JSX expression attribute. That let `<Bar onClick={() => fn()} className=
  // "fill-primary" />` sail through the gate. Fixed by using a `{}`-aware
  // bracket walker to find the opening-tag end before scanning for className.
  it("rejects fill-primary even when a JSX expression with > precedes className", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { ChartContainer } from "@thinkwork/ui";
        import { Bar, BarChart } from "recharts";
        export default function Applet() {
          return (
            <ChartContainer config={{}}>
              <BarChart data={[]}>
                <Bar
                  dataKey="value"
                  onClick={() => console.log(1 > 0)}
                  className="fill-primary"
                />
              </BarChart>
            </ChartContainer>
          );
        }
      `),
    ).toThrow(/Bar uses className="fill-primary"/);
  });

  it("rejects sidebar-family fill classes on Recharts marks", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { ChartContainer } from "@thinkwork/ui";
        import { Bar, BarChart } from "recharts";
        export default function Applet() {
          return (
            <ChartContainer config={{}}>
              <BarChart data={[]}>
                <Bar dataKey="value" className="fill-sidebar-primary" />
              </BarChart>
            </ChartContainer>
          );
        }
      `),
    ).toThrow(/fill-sidebar-primary/);
  });

  it("accepts chart-palette fill classes on Recharts marks", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { ChartContainer } from "@thinkwork/ui";
        import { Bar, BarChart } from "recharts";
        export default function Applet() {
          return (
            <ChartContainer config={{}}>
              <BarChart data={[]}>
                <Bar dataKey="value" className="fill-chart-1" />
              </BarChart>
            </ChartContainer>
          );
        }
      `),
    ).not.toThrow();
  });

  it("accepts Recharts marks without a className attribute", () => {
    expect(() =>
      validateGeneratedAppSourcePolicy(`
        import { ChartContainer } from "@thinkwork/ui";
        import { Bar, BarChart } from "recharts";
        export default function Applet() {
          return (
            <ChartContainer config={{}}>
              <BarChart data={[]}>
                <Bar dataKey="value" fill="var(--chart-2)" />
              </BarChart>
            </ChartContainer>
          );
        }
      `),
    ).not.toThrow();
  });
});
