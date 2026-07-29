"use client";

/**
 * AI Elements <Response> — a thin wrapper around Streamdown for assistant
 * markdown. Plan-012 U8 / contract v1 §AE4: the LLM-UI surfaces render
 * markdown via <Response>, not via raw <Streamdown>. The wrapper exists so
 * a future v2 can swap the underlying renderer (e.g., add CJK / math
 * plugins consistently across the app) in one place.
 *
 * It is also where source citations become interactive: pass the
 * turn's `citations` and any `[n]` marker the model wrote is rendered as a
 * badge linking to that exact document and page.
 */

import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import {
  InlineCitation,
  citationsFromHref,
  linkCitationMarkers,
} from "./inline-citation";
import type { KnowledgeCitation } from "./sources";

export type ResponseProps = ComponentProps<typeof Streamdown> & {
  className?: string;
  /** Numbered knowledge citations for the turn this markdown belongs to. */
  citations?: Map<number, KnowledgeCitation>;
};

export const Response = ({
  className,
  children,
  citations,
  ...props
}: ResponseProps) => {
  const hasCitations = !!citations && citations.size > 0;

  // Markers are rewritten to links so they survive markdown parsing without a
  // custom remark plugin; the anchor override below turns them back into
  // citation badges.
  const body = useMemo(() => {
    if (!hasCitations || typeof children !== "string") return children;
    return linkCitationMarkers(children, citations);
  }, [children, citations, hasCitations]);

  const components = useMemo(() => {
    if (!hasCitations) return props.components;
    // Cast at this boundary only: the markdown renderer's element-component
    // map is typed against its own copy of @types/react, whose Ref type is
    // nominally incompatible with the app's.
    const CitationAnchor = ({
      href,
      children: anchorChildren,
      ...anchorProps
    }: {
      href?: string;
      children?: ReactNode;
    }) => {
      const resolved = citationsFromHref(href, citations);
      if (resolved.length > 0) return <InlineCitation citations={resolved} />;
      return (
        <a href={href} {...anchorProps}>
          {anchorChildren}
        </a>
      );
    };
    return {
      ...props.components,
      a: CitationAnchor,
    } as ComponentProps<typeof Streamdown>["components"];
  }, [citations, hasCitations, props.components]);

  return (
    <div className={cn("ai-response prose prose-sm max-w-none", className)}>
      <Streamdown {...props} components={components}>
        {body}
      </Streamdown>
    </div>
  );
};

Response.displayName = "Response";
