"use client";

/**
 * AI Elements <Response> — a thin wrapper around Streamdown for assistant
 * markdown. Plan-012 U8 / contract v1 §AE4: the LLM-UI surfaces render
 * markdown via <Response>, not via raw <Streamdown>. The wrapper exists so
 * a future v2 can swap the underlying renderer (e.g., add CJK / math
 * plugins consistently across the app) in one place.
 */

import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import type { ComponentProps } from "react";

export type ResponseProps = ComponentProps<typeof Streamdown> & {
	className?: string;
};

export const Response = ({
	className,
	children,
	...props
}: ResponseProps) => (
	<div className={cn("ai-response prose prose-sm max-w-none", className)}>
		<Streamdown {...props}>{children}</Streamdown>
	</div>
);

Response.displayName = "Response";
