import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createCatalogContextProvider() {
  return createSubAgentContextProvider({
    id: "catalog",
    displayName: "Catalog Context",
    sourceFamily: "source-agent",
    promptRef: "brain/provider/catalog",
    prompt: {
      title: "Catalog specialist",
      summary:
        "Retrieve product, service, and SKU context from catalog records once the connector is wired.",
    },
    resources: [
      {
        id: "catalog-items",
        label: "Catalog items",
        type: "Catalog connector",
        description:
          "Products, services, SKUs, pricing hints, and availability metadata.",
        access: "read",
      },
    ],
    skills: [
      {
        id: "catalog-lookup",
        label: "Catalog lookup",
        description:
          "Map user language to product and service records without leaking connector details.",
      },
    ],
    toolAllowlist: ["catalog.item.read"],
    depthCap: 2,
  });
}
