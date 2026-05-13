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
            Table,
            TableBody,
            TableCell,
            TableRow,
          } from "@thinkwork/ui";
          import { KpiStrip } from "@thinkwork/computer-stdlib";
          import { LayoutDashboard } from "lucide-react";
          import { IconChartBar } from "@tabler/icons-react";

          export default function Applet() {
            return (
              <main>
                <Card>
                  <CardContent>
                    <LayoutDashboard />
                    <IconChartBar />
                    <KpiStrip items={[]} />
                    <Badge>CRM Live</Badge>
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

  it("rejects raw HTML tables in CRM dashboard applets", () => {
    expect(() =>
      validateAppletSource(
        `
          import { Card } from "@thinkwork/ui";
          import { KpiStrip } from "@thinkwork/computer-stdlib";

          export default function Applet() {
            return (
              <Card>
                <KpiStrip items={[]} />
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

  it("rejects emoji in CRM dashboard applets", () => {
    expect(() =>
      validateAppletSource(
        `
          import { Card, Table } from "@thinkwork/ui";
          import { KpiStrip } from "@thinkwork/computer-stdlib";

          export default function Applet() {
            return (
              <Card>
                <KpiStrip items={[]} />
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
