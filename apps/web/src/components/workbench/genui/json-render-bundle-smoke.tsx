import { defineCatalog, defineSchema } from "@json-render/core";
import {
  JSONUIProvider,
  Renderer,
  type ComponentRenderer,
} from "@json-render/react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

const bundleSmokeSchema = defineSchema((schema) => ({
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
}));

const bundleSmokeCatalog = defineCatalog(bundleSmokeSchema, {
  components: {
    ThreadSummaryCard: {
      props: z.object({
        title: z.string().min(1),
        value: z.string().min(1),
      }),
    },
  },
  actions: {},
});

const bundleSmokeSpec = {
  root: "summary",
  elements: {
    summary: {
      type: "ThreadSummaryCard",
      props: {
        title: "Pipeline health",
        value: "On track",
      },
      children: [],
    },
  },
};

const validation = bundleSmokeCatalog.validate(bundleSmokeSpec);

if (!validation.success) {
  throw new Error(`Invalid json-render bundle smoke spec: ${validation.error}`);
}

const registry = {
  ThreadSummaryCard: (({ element }) => (
    <section aria-label={element.props.title}>
      <h1>{element.props.title}</h1>
      <p>{element.props.value}</p>
    </section>
  )) satisfies ComponentRenderer<{ title: string; value: string }>,
};

const fallback: ComponentRenderer = ({ element }) => (
  <p role="alert">Unsupported component: {element.type}</p>
);

export function JsonRenderBundleSmoke() {
  return (
    <JSONUIProvider registry={registry}>
      <Renderer
        fallback={fallback}
        registry={registry}
        spec={bundleSmokeSpec as never}
      />
    </JSONUIProvider>
  );
}

const root = document.getElementById("root") ?? document.createElement("div");

if (!root.parentElement) {
  document.body.append(root);
}

createRoot(root).render(<JsonRenderBundleSmoke />);
