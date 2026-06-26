import { render, screen } from "@testing-library/react";
import { defineCatalog, defineSchema } from "@json-render/core";
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
  type ComponentRenderer,
} from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { describe, expect, it } from "vitest";

const shadcnSchema = defineSchema((schema) => ({
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

const shadcnCatalog = defineCatalog(shadcnSchema, {
  components: shadcnComponentDefinitions,
  actions: {},
});

const { registry } = defineRegistry(shadcnCatalog, {
  components: shadcnComponents,
});

function validateShadcnSpec(spec: unknown) {
  const catalogValidation = shadcnCatalog.validate(spec);

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

const fallback: ComponentRenderer = ({ element }) => (
  <p role="alert">Unsupported component: {element.type}</p>
);

function renderWithProviders(spec: unknown, fallbackRenderer = fallback) {
  render(
    <JSONUIProvider registry={registry}>
      <Renderer
        spec={spec as never}
        registry={registry}
        fallback={fallbackRenderer}
      />
    </JSONUIProvider>,
  );
}

describe("json-render adoption smoke", () => {
  it("validates and renders a nested upstream shadcn primitive catalog", () => {
    const spec = {
      root: "card",
      elements: {
        card: {
          type: "Card",
          props: {
            title: "Review queue",
            description: "Current generated UI direction",
            maxWidth: null,
            centered: false,
            className: null,
          },
          children: ["stack"],
        },
        stack: {
          type: "Stack",
          props: {
            direction: "vertical",
            gap: "sm",
            align: null,
            justify: null,
            className: null,
          },
          children: ["heading", "summary", "approve"],
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
            text: "All checks are ready.",
            variant: "body",
          },
          children: [],
        },
        approve: {
          type: "Button",
          props: {
            label: "Approve",
            variant: "primary",
            disabled: false,
          },
          children: [],
        },
      },
    };

    const validation = validateShadcnSpec(spec);

    expect(validation.success).toBe(true);
    renderWithProviders(spec);
    expect(screen.getByText("Pipeline health")).toBeTruthy();
    expect(screen.getByText("All checks are ready.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("fails validation before render for an unknown component", () => {
    const validation = validateShadcnSpec({
      root: "chart",
      elements: {
        chart: {
          type: "UnapprovedChart3D",
          props: { title: "Nope" },
          children: [],
        },
      },
    });

    expect(validation.success).toBe(false);
    expect(String(validation.error)).toContain("Card");
    expect(String(validation.error)).toContain("type");
  });

  it("fails validation before render for invalid component props", () => {
    const validation = validateShadcnSpec({
      root: "button",
      elements: {
        button: {
          type: "Button",
          props: {
            label: "Approve",
            variant: "tertiary",
            disabled: false,
          },
          children: [],
        },
      },
    });

    expect(validation.success).toBe(false);
    expect(String(validation.error)).toContain("variant");
  });

  it("does not treat legacy data-genui envelopes as the new contract", () => {
    const validation = validateShadcnSpec({
      type: "data-genui",
      id: "legacy",
      data: {
        schemaVersion: "thread-genui/v1",
        spec: {
          root: "review",
          elements: {},
        },
      },
    });

    expect(validation.success).toBe(false);
  });

  it("renders the configured fallback for renderer-level unknown types", () => {
    renderWithProviders({
      root: "mystery",
      elements: {
        mystery: {
          type: "MissingRenderer",
          props: {},
          children: [],
        },
      },
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Unsupported component: MissingRenderer",
    );
  });
});
