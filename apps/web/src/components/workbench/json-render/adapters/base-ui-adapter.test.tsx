import { defineCatalog } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { threadJsonRenderSchema } from "@thinkwork/thread-json-render";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { TracerButton } from "./base-ui-adapter";

/**
 * U1 tracer: proves the json-render 0.19 registry drives a real Base UI
 * primitive through our adapter contract, and that a partial/streaming frame
 * does not throw. This is the de-risk the rest of the Base UI catalog (U3/U4/
 * U10) depends on.
 */
const tracerCatalog = defineCatalog(threadJsonRenderSchema, {
  components: {
    "tracer.button": {
      props: z
        .object({
          label: z.string().optional(),
          event: z.string().optional(),
          disabled: z.boolean().optional(),
        })
        .strict(),
    },
  },
  actions: {},
});

const { registry } = defineRegistry(tracerCatalog, {
  components: { "tracer.button": TracerButton },
});

function renderSpec(props: Record<string, unknown>, loading = false) {
  const spec = {
    root: "btn",
    elements: {
      btn: { type: "tracer.button", props, children: [] as string[] },
    },
  };
  return render(
    <JSONUIProvider registry={registry}>
      <Renderer registry={registry} spec={spec} loading={loading} />
    </JSONUIProvider>,
  );
}

afterEach(() => cleanup());

describe("base-ui-adapter (U1 tracer)", () => {
  it("renders a Base UI Button through the json-render 0.19 registry", () => {
    renderSpec({ label: "Approve", event: "press" });
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("is clickable without throwing (emit wiring is inert with no action binding)", () => {
    renderSpec({ label: "Approve" });
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Approve" })),
    ).not.toThrow();
  });

  it("tolerates a partial/streaming frame with no props (KTD7)", () => {
    expect(() => renderSpec({}, true)).not.toThrow();
    // loading placeholder, not a crash
    expect(screen.getByRole("button")).toBeTruthy();
  });
});
