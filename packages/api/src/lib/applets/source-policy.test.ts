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
});
