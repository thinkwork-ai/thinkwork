import { render, screen } from "@testing-library/react";
import { defineCatalog, defineSchema } from "@json-render/core";
import {
  JSONUIProvider,
  Renderer,
  type ComponentRenderer,
} from "@json-render/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const spikeSchema = defineSchema((schema) => ({
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

const spikeCatalog = defineCatalog(spikeSchema, {
  components: {
    TaskReviewCard: {
      props: z.object({
        title: z.string().min(1),
        status: z.enum(["pending", "approved"]),
      }),
    },
  },
  actions: {},
});

const registry = {
  TaskReviewCard: (({ element }) => (
    <article aria-label={element.props.title}>
      <h2>{element.props.title}</h2>
      <p>{element.props.status}</p>
    </article>
  )) satisfies ComponentRenderer<{
    title: string;
    status: "pending" | "approved";
  }>,
};

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
  it("validates and renders a minimal host-owned component catalog", () => {
    const spec = {
      root: "review",
      elements: {
        review: {
          type: "TaskReviewCard",
          props: {
            title: "Review onboarding task",
            status: "pending",
          },
          children: [],
        },
      },
    };

    const validation = spikeCatalog.validate(spec);

    expect(validation.success).toBe(true);
    renderWithProviders(spec);
    expect(screen.getByRole("article").getAttribute("aria-label")).toBe(
      "Review onboarding task",
    );
    expect(screen.getByText("pending")).toBeTruthy();
  });

  it("fails validation before render for an unknown component", () => {
    const validation = spikeCatalog.validate({
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
    expect(String(validation.error)).toContain("TaskReviewCard");
    expect(String(validation.error)).toContain("type");
  });

  it("fails validation before render for invalid component props", () => {
    const validation = spikeCatalog.validate({
      root: "review",
      elements: {
        review: {
          type: "TaskReviewCard",
          props: {
            title: "",
            status: "done",
          },
          children: [],
        },
      },
    });

    expect(validation.success).toBe(false);
    expect(String(validation.error)).toContain("status");
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
