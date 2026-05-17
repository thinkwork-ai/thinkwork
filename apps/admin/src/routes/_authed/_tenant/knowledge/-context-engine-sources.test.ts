import { describe, expect, it } from "vitest";
import type { ContextProviderSummary } from "@/lib/context-engine-api";
import {
  WEB_SEARCH_PROVIDER_ID,
  WEB_SEARCH_PROVIDER_PENDING_KEY,
  backendDefaultProviderIds,
  contextSourceRows,
  defaultSelectedProviderIds,
  providerIdsForQuery,
  providerSelectable,
  visibleContextProviders,
} from "./-context-engine-sources";

function provider(
  overrides: Partial<ContextProviderSummary> & { id: string },
): ContextProviderSummary {
  return {
    family: "memory",
    displayName: overrides.id,
    defaultEnabled: false,
    ...overrides,
  };
}

describe("context engine source helpers", () => {
  it("keeps actionable sources visible", () => {
    const sources = [
      provider({ id: "memory", displayName: "Memory", defaultEnabled: true }),
      provider({
        id: "brain",
        family: "brain",
        sourceFamily: "brain",
        displayName: "Ontology Brain",
        defaultEnabled: true,
      }),
      provider({
        id: "wiki",
        family: "wiki",
        displayName: "Pages",
        defaultEnabled: true,
      }),
      provider({
        id: "workspace",
        family: "workspace",
        displayName: "Workspace Files",
      }),
      provider({
        id: "kb",
        family: "knowledge-base",
        displayName: "Bedrock Knowledge Bases",
      }),
      provider({
        id: "builtin:web",
        family: "mcp",
        sourceFamily: "web",
        displayName: "Exa Research",
      }),
    ];

    expect(visibleContextProviders(sources).map((source) => source.id)).toEqual(
      ["memory", "brain", "wiki", "workspace", "kb", "builtin:web"],
    );
  });

  it("hides inert or undeclared source-agent seams from visible rows and defaults", () => {
    const sources = [
      provider({ id: "memory", displayName: "Memory", defaultEnabled: true }),
      provider({
        id: "erp",
        family: "sub-agent",
        displayName: "ERP Customer Context",
        defaultEnabled: true,
        subAgent: {
          promptRef: "erp",
          toolAllowlist: [],
          depthCap: 1,
          processModel: "lambda-bedrock-converse",
          seamState: "inert",
        },
      }),
      provider({
        id: "crm",
        family: "sub-agent",
        displayName: "CRM Opportunity Context",
        defaultEnabled: true,
      }),
    ];

    expect(visibleContextProviders(sources).map((source) => source.id)).toEqual(
      ["memory"],
    );
    expect(defaultSelectedProviderIds(sources)).toEqual(["memory"]);
    expect(contextSourceRows(sources).map((row) => row.id)).toEqual(["memory"]);
  });

  it("keeps live source-agent providers visible and selectable", () => {
    const sources = [
      provider({
        id: "company-brain-page-agent",
        family: "sub-agent",
        displayName: "Company Brain Page Agent",
        defaultEnabled: true,
        subAgent: {
          promptRef: "wiki",
          toolAllowlist: ["search_wiki"],
          depthCap: 1,
          processModel: "deterministic-retrieval",
          seamState: "live",
        },
      }),
    ];

    const rows = contextSourceRows(sources);

    expect(rows).toHaveLength(1);
    expect(rows[0].badge).toEqual({ label: "live", state: "live" });
    expect(rows[0].selectable).toBe(true);
  });

  it("keeps disabled providers visible but not selectable", () => {
    const source = provider({
      id: "workspace",
      family: "workspace",
      displayName: "Workspace Files",
      enabled: false,
    });

    expect(visibleContextProviders([source])).toEqual([source]);
    expect(providerSelectable(source)).toBe(false);
    expect(contextSourceRows([source])[0].badge).toEqual({
      label: "disabled",
      state: "disabled",
    });
  });

  it("keeps pending web-search fallback visible but not selectable", () => {
    const source = provider({
      id: WEB_SEARCH_PROVIDER_ID,
      family: "mcp",
      sourceFamily: "web",
      displayName: "Exa Research",
      config: { [WEB_SEARCH_PROVIDER_PENDING_KEY]: true },
    });

    const rows = contextSourceRows([source]);

    expect(rows).toHaveLength(1);
    expect(rows[0].badge).toEqual({ label: "waiting on API", state: "stale" });
    expect(rows[0].selectable).toBe(false);
  });

  it("sends explicit visible defaults when backend defaults include hidden providers", () => {
    const sources = [
      provider({ id: "memory", displayName: "Memory", defaultEnabled: true }),
      provider({
        id: "erp",
        family: "sub-agent",
        displayName: "ERP Customer Context",
        defaultEnabled: true,
        subAgent: {
          promptRef: "erp",
          toolAllowlist: [],
          depthCap: 1,
          processModel: "lambda-bedrock-converse",
          seamState: "inert",
        },
      }),
    ];

    const visibleDefaults = defaultSelectedProviderIds(sources);
    const backendDefaults = backendDefaultProviderIds(sources);

    expect(visibleDefaults).toEqual(["memory"]);
    expect(backendDefaults).toEqual(["memory", "erp"]);
    expect(
      providerIdsForQuery({
        selectedProviderIds: visibleDefaults,
        visibleDefaultProviderIds: visibleDefaults,
        backendDefaultProviderIds: backendDefaults,
      }),
    ).toEqual(["memory"]);
  });

  it("omits provider ids when selected providers match backend-visible defaults", () => {
    const sources = [
      provider({ id: "memory", displayName: "Memory", defaultEnabled: true }),
      provider({ id: "wiki", family: "wiki", displayName: "Pages" }),
    ];
    const visibleDefaults = defaultSelectedProviderIds(sources);

    expect(
      providerIdsForQuery({
        selectedProviderIds: visibleDefaults,
        visibleDefaultProviderIds: visibleDefaults,
        backendDefaultProviderIds: backendDefaultProviderIds(sources),
      }),
    ).toBeUndefined();
  });
});
