import { describe, expect, it } from "vitest";
import {
  mcpOAuthCompletionUrl,
  normalizeMcpOAuthReturnTo,
  resolveMcpOAuthResource,
} from "./mcp-oauth-client.js";

describe("MCP OAuth client helpers", () => {
  it("prefers the configured MCP OAuth resource", () => {
    expect(
      resolveMcpOAuthResource({
        serverUrl: "https://crm.thinkwork.ai/mcp",
        authConfig: { oauth_resource: "https://crm.thinkwork.ai/mcp/" },
        resourceMetadata: { resource: "https://other.example/mcp" },
      }),
    ).toBe("https://crm.thinkwork.ai/mcp");
  });

  it("falls back to discovered protected-resource metadata", () => {
    expect(
      resolveMcpOAuthResource({
        serverUrl: "https://crm.thinkwork.ai/mcp",
        authConfig: {},
        resourceMetadata: { resource: "https://crm.thinkwork.ai/mcp/" },
      }),
    ).toBe("https://crm.thinkwork.ai/mcp");
  });

  it("allows localhost desktop return URLs", () => {
    expect(
      normalizeMcpOAuthReturnTo(
        "http://localhost:5175/settings/mcp-servers/server-1",
      ),
    ).toBe("http://localhost:5175/settings/mcp-servers/server-1");
  });

  it("allows configured web return origins", () => {
    expect(
      normalizeMcpOAuthReturnTo(
        "https://spaces.example.com/settings/mcp-servers/server-1",
        { SPACES_URL: "https://spaces.example.com" },
      ),
    ).toBe("https://spaces.example.com/settings/mcp-servers/server-1");
  });

  it("blocks arbitrary web return origins", () => {
    expect(
      normalizeMcpOAuthReturnTo("https://evil.example/settings/mcp-servers"),
    ).toBeNull();
  });

  it("keeps mobile deep-link completion as the default", () => {
    expect(mcpOAuthCompletionUrl(null, "success")).toBe(
      "thinkwork://mcp-oauth-complete?status=success",
    );
  });

  it("adds completion params to web return URLs", () => {
    expect(
      mcpOAuthCompletionUrl(
        "http://localhost:5175/settings/mcp-servers/server-1?tab=auth",
        "success",
        { mcpServerId: "server-1" },
      ),
    ).toBe(
      "http://localhost:5175/settings/mcp-servers/server-1?tab=auth&mcpOAuth=success&mcpServerId=server-1",
    );
  });
});
