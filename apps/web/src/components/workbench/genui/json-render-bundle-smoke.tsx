import { defineCatalog, defineSchema } from "@json-render/core";
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
  type ComponentRenderer,
} from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { createRoot } from "react-dom/client";

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
  components: shadcnComponentDefinitions,
  actions: {},
});

function validateBundleSmokeSpec(spec: unknown) {
  const catalogValidation = bundleSmokeCatalog.validate(spec);

  if (!catalogValidation.success || !catalogValidation.data) {
    return catalogValidation;
  }

  for (const element of Object.values(catalogValidation.data.elements)) {
    const definition =
      shadcnComponentDefinitions[
        element.type as keyof typeof shadcnComponentDefinitions
      ];
    const propsValidation = definition?.props.safeParse(element.props);

    if (!propsValidation?.success) {
      return {
        success: false as const,
        error: propsValidation?.error ?? new Error("Unknown shadcn component"),
      };
    }
  }

  return catalogValidation;
}

const bundleSmokeSpec = {
  root: "card",
  elements: {
    card: {
      type: "Card",
      props: {
        title: "Pipeline health",
        description: "On track",
        maxWidth: null,
        centered: false,
        className: null,
      },
      children: ["content"],
    },
    content: {
      type: "Stack",
      props: {
        direction: "vertical",
        gap: "sm",
        align: null,
        justify: null,
        className: null,
      },
      children: ["heading", "summary", "action"],
    },
    heading: {
      type: "Heading",
      props: {
        text: "Pipeline health",
        level: "h3",
      },
      children: [],
    },
    summary: {
      type: "Text",
      props: {
        text: "On track",
        variant: "body",
      },
      children: [],
    },
    action: {
      type: "Button",
      props: {
        label: "Open",
        variant: "secondary",
        disabled: false,
      },
      children: [],
    },
  },
};

const validation = validateBundleSmokeSpec(bundleSmokeSpec);

if (!validation.success) {
  throw new Error(`Invalid json-render bundle smoke spec: ${validation.error}`);
}

const { registry } = defineRegistry(bundleSmokeCatalog, {
  components: shadcnComponents,
});

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
