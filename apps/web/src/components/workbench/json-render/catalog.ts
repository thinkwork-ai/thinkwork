import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import {
  threadJsonRenderLocalActionDefinitions,
  threadJsonRenderPrimitiveComponentDefinitions,
  threadJsonRenderSchema,
} from "@thinkwork/thread-json-render";

import { threadJsonRenderPrimitiveComponents } from "./primitives";

/**
 * Catalog *definitions* (schema, component prop schemas, names, the assembled
 * catalog) live in a single source of truth — `@thinkwork/thread-json-render`
 * — so a new component is declared once and flows to the validator, the
 * system-prompt catalog list, and this renderer without a second edit (KTD4).
 *
 * This module only owns the web-specific concern: mapping those definitions to
 * concrete React implementations via `@json-render/react`. The primitive
 * implementations are ThinkWork-owned (Base UI + styled semantic HTML) and live
 * in `./primitives` — the former `@json-render/shadcn` layer is gone (U10).
 * Definitions are re-exported below so existing importers keep the same path.
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

// Web-only: the ThinkWork-owned primitive React components and their registry.
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
    components: threadJsonRenderPrimitiveComponents,
  },
);

export { threadJsonRenderPrimitiveComponents };
