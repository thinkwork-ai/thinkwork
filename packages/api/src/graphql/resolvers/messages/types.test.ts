import { describe, expect, it } from "vitest";
import { messageTypeResolvers } from "./types.js";

describe("message owner identity", () => {
  it("derives owner identity from persisted sender fields", () => {
    const message = {
      role: "USER",
      sender_type: "user",
      sender_id: "user-1",
    };

    expect(messageTypeResolvers.ownerType(message)).toBe("user");
    expect(messageTypeResolvers.ownerId(message)).toBe("user-1");
  });

  it("falls back to role semantics when sender fields are absent", () => {
    const message = { role: "ASSISTANT" };

    expect(messageTypeResolvers.ownerType(message)).toBe("agent");
    expect(messageTypeResolvers.ownerId(message)).toBeNull();
  });

  it("keeps Computer-originated legacy messages attributable", () => {
    const message = {
      role: "ASSISTANT",
      senderType: "computer",
      senderId: "computer-1",
    };

    expect(messageTypeResolvers.ownerType(message)).toBe("computer");
    expect(messageTypeResolvers.ownerId(message)).toBe("computer-1");
  });

  it("keeps legacy sender resolution separate from explicit owner fields", async () => {
    const userLoader = {
      load: async () => ({ name: "Eric", email: "eric@example.com" }),
    };
    const sender = await messageTypeResolvers.sender(
      {
        role: "USER",
        senderType: "user",
        senderId: "user-1",
        ownerType: "agent",
        ownerId: "agent-1",
      },
      null,
      {
        loaders: { user: userLoader, agent: { load: async () => null } },
      } as any,
    );

    expect(sender).toMatchObject({
      type: "user",
      id: "user-1",
      displayName: "Eric",
    });
  });

  it("uses email metadata for unresolved email reply senders", async () => {
    const sender = await messageTypeResolvers.sender(
      {
        role: "USER",
        senderType: "user",
        senderId: null,
        metadata: { source: "email_reply", senderEmail: "customer@acme.com" },
      },
      null,
      {
        loaders: {
          user: { load: async () => null },
          agent: { load: async () => null },
        },
      } as any,
    );

    expect(sender).toMatchObject({
      type: "user",
      id: null,
      displayName: "customer@acme.com",
    });
  });
});
