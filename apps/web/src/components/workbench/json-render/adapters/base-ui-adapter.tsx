import type { ReactNode } from "react";
import { Button as BaseButton } from "@base-ui/react/button";

/**
 * json-render 0.19 component-context contract.
 *
 * Pinned empirically from the installed `@json-render/react` type defs
 * (`dist/index.d.ts` — `BaseComponentProps` / `ComponentContext`, KTD1/R-B).
 * Components registered via `defineRegistry` receive THIS object, not raw
 * React props. Key fields:
 *  - `props`   fully-resolved, catalog-typed prop object
 *  - `emit`    fire a named event; the renderer resolves it to the element's
 *              `on` action binding(s)
 *  - `loading` set by the renderer during streaming / partial frames — the
 *              signal a component uses to tolerate not-yet-arrived props (KTD7)
 *
 * Every Base UI (or recharts) component is wrapped in a thin adapter that
 * unpacks this context onto the underlying component. This is json-render's
 * intended extension path and is what lets us drop `@json-render/shadcn`.
 */
export interface JsonRenderContext<P = Record<string, unknown>> {
  props: P;
  children?: ReactNode;
  emit: (event: string) => void;
  on?: (event: string) => unknown;
  bindings?: Record<string, string>;
  loading?: boolean;
}

export type JsonRenderComponentFn<P = Record<string, unknown>> = (
  ctx: JsonRenderContext<P>,
) => ReactNode;

/**
 * Tracer component (U1). Proves a real Base UI primitive renders through the
 * json-render 0.19 context contract, including partial-frame tolerance. It is
 * NOT part of the shipped catalog — it exists to de-risk the adapter pattern
 * that U3/U4/U10 build on.
 */
export interface TracerButtonProps {
  label?: string;
  event?: string;
  disabled?: boolean;
}

export const TracerButton: JsonRenderComponentFn<TracerButtonProps> = ({
  props,
  children,
  emit,
  loading,
}) => {
  // Partial-frame tolerance (KTD7): during streaming a required prop may not
  // have arrived yet. Never throw — render a benign placeholder instead.
  const label = props?.label ?? (loading ? "…" : "");
  const event = props?.event ?? "press";

  return (
    <BaseButton
      type="button"
      disabled={props?.disabled ?? false}
      onClick={() => emit(event)}
    >
      {label}
      {children}
    </BaseButton>
  );
};
