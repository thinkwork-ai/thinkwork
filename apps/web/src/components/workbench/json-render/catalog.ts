import { defineCatalog, defineSchema } from "@json-render/core"
import { defineRegistry } from "@json-render/react"
import { shadcnComponents } from "@json-render/shadcn"
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog"

import {
  threadJsonRenderDomainComponentDefinitions,
  threadJsonRenderDomainComponentNames,
} from "./domain-catalog"

export const threadJsonRenderSchema = defineSchema((schema) => ({
  spec: schema.object({
    root: schema.string(),
    elements: schema.record(
      schema.object({
        type: schema.ref("catalog.components"),
        props: schema.propsOf("catalog.components"),
        children: schema.array(schema.string()),
      }),
    ),
  }),
  catalog: schema.object({
    components: schema.map({ props: schema.zod() }),
    actions: schema.map({ params: schema.zod() }),
  }),
}))

export const threadJsonRenderPrimitiveComponentDefinitions =
  shadcnComponentDefinitions

export const threadJsonRenderPrimitiveComponentNames = Object.keys(
  threadJsonRenderPrimitiveComponentDefinitions,
)

export const threadJsonRenderLocalActionDefinitions = {}

export const threadJsonRenderComponentDefinitions = {
  ...threadJsonRenderPrimitiveComponentDefinitions,
  ...threadJsonRenderDomainComponentDefinitions,
}

export const threadJsonRenderComponentNames = Object.keys(
  threadJsonRenderComponentDefinitions,
)

export const threadJsonRenderCatalog = defineCatalog(threadJsonRenderSchema, {
  components: threadJsonRenderComponentDefinitions,
  actions: threadJsonRenderLocalActionDefinitions,
})

export const threadJsonRenderPrimitiveCatalog = defineCatalog(
  threadJsonRenderSchema,
  {
    components: threadJsonRenderPrimitiveComponentDefinitions,
    actions: threadJsonRenderLocalActionDefinitions,
  },
)

export const { registry: threadJsonRenderPrimitiveRegistry } = defineRegistry(
  threadJsonRenderPrimitiveCatalog,
  {
    components: shadcnComponents,
  },
)

export {
  threadJsonRenderDomainComponentDefinitions,
  threadJsonRenderDomainComponentNames,
}
