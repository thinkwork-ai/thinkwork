import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import {
  threadJsonRenderLocalActionDefinitions,
  threadJsonRenderPrimitiveComponentDefinitions,
  threadJsonRenderSchema,
} from "@thinkwork/thread-json-render";

/**
 * Catalog *definitions* (schema, component prop schemas, names, the assembled
 * catalog) live in a single source of truth — `@thinkwork/thread-json-render`
 * — so a new component is declared once and flows to the validator, the
 * system-prompt catalog list, and this renderer without a second edit (KTD4).
 *
 * This module only owns the web-specific concern: mapping those definitions to
 * concrete React implementations via `@json-render/react`. Definitions are
 * re-exported below so existing importers keep the same import path.
 */
export {
  threadJsonRenderCatalog,
  threadJsonRenderComponentDefinitions,
  threadJsonRenderComponentNames,
  threadJsonRenderDomainComponentDefinitions,
  threadJsonRenderDomainComponentNames,
  threadJsonRenderLocalActionDefinitions,
  threadJsonRenderPrimitiveComponentDefinitions,
  threadJsonRenderPrimitiveComponentNames,
  threadJsonRenderSchema,
} from "@thinkwork/thread-json-render";

// Web-only: the upstream shadcn primitive React components and their registry.
export const threadJsonRenderPrimitiveCatalog = defineCatalog(
  threadJsonRenderSchema,
  {
    components: threadJsonRenderPrimitiveComponentDefinitions,
    actions: threadJsonRenderLocalActionDefinitions,
  },
);

export const { registry: threadJsonRenderPrimitiveRegistry } = defineRegistry(
  threadJsonRenderPrimitiveCatalog,
  {
    components: shadcnComponents,
  },
);

export { shadcnComponents as threadJsonRenderPrimitiveComponents };
