import { describe, expect, it, vi } from "vitest";

vi.mock("../../graphql/utils.js", () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  db: {},
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  spaceMembers: {},
  spaces: {
    tenant_id: "spaces.tenant_id",
    slug: "spaces.slug",
    id: "spaces.id",
    status: "spaces.status",
  },
}));

import {
  DEFAULT_AGENT_CONTEXT_SPACE_SLUG,
  DEFAULT_THREADS_SPACE_SLUG,
  defaultAgentContextSpaceValues,
} from "./default-space.js";

describe("default Spaces", () => {
  it("keeps the thread bucket and agent context defaults explicit", () => {
    expect(DEFAULT_THREADS_SPACE_SLUG).toBe("general");
    expect(DEFAULT_AGENT_CONTEXT_SPACE_SLUG).toBe("default");
  });

  it("builds a default contextual Space definition for agents", () => {
    const values = defaultAgentContextSpaceValues("tenant-1");

    expect(values).toMatchObject({
      tenant_id: "tenant-1",
      slug: "default",
      name: "Default",
      status: "active",
      kind: "custom",
      template_key: "default",
      category: "default",
      config: {
        workflow: "default",
        source: "api_default_context",
      },
      agent_availability_policy: {
        autoSubscribeAssignedAgents: true,
      },
    });
  });
});
