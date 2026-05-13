import { describe, expect, it } from "vitest";
import {
  AppletImportError,
  AppletQualityError,
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

  it("accepts CRM dashboard applets that use the platform component libraries", () => {
    expect(
      validateAppletSource(
        `
          import React from "react";
          import {
            Badge,
            Card,
            CardContent,
            ChartContainer,
            Table,
            TableBody,
            TableCell,
            TableRow,
          } from "@thinkwork/ui";
          import { KpiStrip } from "@thinkwork/computer-stdlib";
          import { Bar, BarChart } from "recharts";

          export default function Applet() {
            return (
              <main>
                <Card>
                  <CardContent>
                    <KpiStrip cards={[]} />
                    <Badge>CRM Live</Badge>
                    <ChartContainer config={{ amount: { label: "Amount" } }}>
                      <BarChart data={[]}>
                        <Bar dataKey="amount" />
                      </BarChart>
                    </ChartContainer>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>Opportunity</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </main>
            );
          }
        `,
        {
          metadata: {
            recipe: "crm-dashboard",
            dataShape: "CrmDashboardData",
          },
          name: "CRM Dashboard",
        },
      ),
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

  it("accepts lucide-react named icon imports for generated applets", () => {
    expect(
      validateAppletSource(`
        import { Calendar } from "lucide-react";
        export default function Applet() { return <Calendar />; }
      `),
    ).toEqual({ ok: true });
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

  it("rejects CRM dashboard applets that omit @thinkwork/ui", () => {
    expect(() =>
      validateAppletSource(
        `
          export default function Applet() {
            return <div>CRM dashboard</div>;
          }
        `,
        { metadata: { recipe: "crm-dashboard" } },
      ),
    ).toThrow(AppletQualityError);
  });

  it("rejects CRM dashboard applets that omit computer-stdlib primitives", () => {
    expect(() =>
      validateAppletSource(
        `
          import { Card, Table } from "@thinkwork/ui";

          export default function Applet() {
            return <Card><Table /></Card>;
          }
        `,
        { metadata: { recipe: "crm-dashboard" } },
      ),
    ).toThrow(/computer-stdlib/);
  });

  it("rejects CRM dashboard applets with hand-composed metric cards", () => {
    expect(() =>
      validateAppletSource(
        `
          import { Card, CardContent, Table } from "@thinkwork/ui";
          import { BarChart } from "@thinkwork/computer-stdlib";

          export default function Applet() {
            return (
              <main>
                <Card><CardContent>Active Opps 82</CardContent></Card>
                <Card><CardContent>Pipeline $1.5M</CardContent></Card>
                <Card><CardContent>Stale 50</CardContent></Card>
                <Table />
                <BarChart data={[]} />
              </main>
            );
          }
        `,
        { metadata: { recipe: "crm-dashboard" } },
      ),
    ).toThrow(/KpiStrip/);
  });

  it("rejects CRM dashboard applets that rely on generated grid-column layout classes", () => {
    expect(() =>
      validateAppletSource(
        `
          import { Card, Table } from "@thinkwork/ui";
          import { KpiStrip } from "@thinkwork/computer-stdlib";

          export default function Applet() {
            return (
              <main className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiStrip cards={[]} />
                <Card><Table /></Card>
              </main>
            );
          }
        `,
        { metadata: { recipe: "crm-dashboard" } },
      ),
    ).toThrow(/grid-column/);
  });

  it("rejects raw HTML tables in CRM dashboard applets", () => {
    expect(() =>
      validateAppletSource(
        `
          import { Card } from "@thinkwork/ui";
          import { KpiStrip } from "@thinkwork/computer-stdlib";

          export default function Applet() {
            return (
              <Card>
                <KpiStrip cards={[]} />
                <table>
                  <tbody>
                    <tr>
                      <td>Deal</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            );
          }
        `,
        { metadata: { runbookSlug: "crm-dashboard" } },
      ),
    ).toThrow(AppletQualityError);
  });

  it("rejects raw HTML buttons even when Button is imported", () => {
    expect(() =>
      validateAppletSource(`
        import { Button, Card } from "@thinkwork/ui";
        export default function Applet() {
          return <Card><button>Save</button><Button>Save</Button></Card>;
        }
      `),
    ).toThrow(/Button/);
  });

  it("rejects Recharts primitives outside ChartContainer", () => {
    expect(() =>
      validateAppletSource(`
        import { Card } from "@thinkwork/ui";
        import { Line, LineChart } from "recharts";
        export default function Applet() {
          return <Card><LineChart data={[]}><Line dataKey="value" /></LineChart></Card>;
        }
      `),
    ).toThrow(/ChartContainer/);
  });

  it("accepts Recharts primitives inside ChartContainer", () => {
    expect(
      validateAppletSource(`
        import { Card, ChartContainer } from "@thinkwork/ui";
        import { Line, LineChart } from "recharts";
        export default function Applet() {
          return (
            <Card>
              <ChartContainer config={{ value: { label: "Value" } }}>
                <LineChart data={[]}>
                  <Line dataKey="value" />
                </LineChart>
              </ChartContainer>
            </Card>
          );
        }
      `),
    ).toEqual({ ok: true });
  });

  it("rejects raw map libraries and accepts the host map component", () => {
    expect(() =>
      validateAppletSource(`
        import { MapContainer } from "react-leaflet";
        export default function Applet() { return <MapContainer />; }
      `),
    ).toThrow(AppletImportError);

    expect(
      validateAppletSource(`
        import { MapView } from "@thinkwork/computer-stdlib";
        export default function Applet() { return <MapView markers={[]} />; }
      `),
    ).toEqual({ ok: true });
  });

  it("rejects hand-rolled card styling and arbitrary Tailwind values", () => {
    expect(() =>
      validateAppletSource(`
        export default function Applet() {
          return <div className="rounded-lg border bg-white shadow-sm p-4">Card</div>;
        }
      `),
    ).toThrow(/Card/);

    expect(() =>
      validateAppletSource(`
        import { Card } from "@thinkwork/ui";
        export default function Applet() {
          return <Card><div className="max-w-[1280px]">Wide</div></Card>;
        }
      `),
    ).toThrow(/arbitrary Tailwind/);
  });

  it("rejects emoji in CRM dashboard applets", () => {
    expect(() =>
      validateAppletSource(
        `
          import { Card, Table } from "@thinkwork/ui";
          import { KpiStrip } from "@thinkwork/computer-stdlib";

          export default function Applet() {
            return (
              <Card>
                <KpiStrip cards={[]} />
                <Table />
                <span>✅ CRM Live</span>
              </Card>
            );
          }
        `,
        { metadata: { dataShape: "CrmDashboardData" } },
      ),
    ).toThrow(AppletQualityError);
  });
});
