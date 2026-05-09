import { describe, expect, it } from "vitest";
import {
  mutationResolvers,
  queryResolvers,
} from "../graphql/resolvers/index.js";

describe("applet GraphQL resolvers", () => {
  it("registers inert applet query resolvers", async () => {
    await expect(
      queryResolvers.applet(null, { id: "artifact-1" }, {} as any),
    ).rejects.toThrow("INERT_NOT_WIRED");
    await expect(
      queryResolvers.appletState(
        null,
        { tenantId: "tenant-A", appId: "pipeline-risk" },
        {} as any,
      ),
    ).rejects.toThrow("INERT_NOT_WIRED");
  });

  it("registers inert applet mutation resolvers", async () => {
    await expect(
      mutationResolvers.saveApplet(
        null,
        {
          input: {
            tenantId: "tenant-A",
            appId: "pipeline-risk",
            name: "Pipeline Risk",
            version: 1,
            source: "export default function Applet() { return null; }",
          },
        },
        {} as any,
      ),
    ).rejects.toThrow("INERT_NOT_WIRED");
    await expect(
      mutationResolvers.saveAppletState(
        null,
        {
          input: {
            tenantId: "tenant-A",
            appId: "pipeline-risk",
            state: {},
          },
        },
        {} as any,
      ),
    ).rejects.toThrow("INERT_NOT_WIRED");
  });
});
