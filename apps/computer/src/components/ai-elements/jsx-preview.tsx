"use client";

import JsxParser, { type TProps as JsxParserProps } from "react-jsx-parser";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type JSXPreviewContextValue = {
  bindings?: JsxParserProps["bindings"];
  components?: NonNullable<JsxParserProps["components"]>;
  error: Error | null;
  jsx: string;
  onError?: (error: Error) => void;
  setError: (error: Error | null) => void;
};

const JSXPreviewContext = createContext<JSXPreviewContextValue | null>(null);

function useJSXPreview() {
  const context = useContext(JSXPreviewContext);
  if (!context) {
    throw new Error("JSXPreview components must be used within JSXPreview");
  }
  return context;
}

export type JSXPreviewProps = ComponentProps<"div"> & {
  jsx: string;
  isStreaming?: boolean;
  components?: NonNullable<JsxParserProps["components"]>;
  bindings?: JsxParserProps["bindings"];
  onError?: (error: Error) => void;
};

export function JSXPreview({
  className,
  children,
  jsx,
  isStreaming = false,
  components,
  bindings,
  onError,
  ...props
}: JSXPreviewProps) {
  const [error, setError] = useState<Error | null>(null);
  const previewJsx = useMemo(
    () => (isStreaming ? completeStreamingJsx(jsx) : jsx),
    [isStreaming, jsx],
  );

  return (
    <JSXPreviewContext.Provider
      value={{
        bindings,
        components,
        error,
        jsx: previewJsx,
        onError,
        setError,
      }}
    >
      <div
        className={cn("grid min-h-0 min-w-0 gap-2", className)}
        data-jsx-preview-streaming={isStreaming ? "" : undefined}
        {...props}
      >
        {children ?? (
          <>
            <JSXPreviewContent />
            <JSXPreviewError />
          </>
        )}
      </div>
    </JSXPreviewContext.Provider>
  );
}

export type JSXPreviewContentProps = Omit<
  JsxParserProps,
  | "allowUnknownElements"
  | "autoCloseVoidElements"
  | "blacklistedAttrs"
  | "blacklistedTags"
  | "componentsOnly"
  | "jsx"
  | "renderInWrapper"
> & {
  jsx?: string;
  renderError?: JsxParserProps["renderError"];
};

export function JSXPreviewContent({
  bindings,
  className,
  components,
  jsx,
  onError,
  renderError,
  ...props
}: JSXPreviewContentProps) {
  const context = useJSXPreview();
  const resolvedComponents = components ?? context.components;
  const resolvedJsx = jsx ?? context.jsx;
  const resolvedBindings = bindings ?? context.bindings;
  const resolvedOnError = onError ?? context.onError;
  const { setError } = context;
  const structureError = useMemo(
    () => findJsxStructureError(resolvedJsx),
    [resolvedJsx],
  );

  useEffect(() => {
    if (!structureError) return;
    setError(structureError);
    resolvedOnError?.(structureError);
  }, [resolvedOnError, setError, structureError]);

  if (structureError) {
    return renderError ? (
      <>{renderError({ error: structureError.message })}</>
    ) : null;
  }

  return (
    <JsxParser
      allowUnknownElements={false}
      autoCloseVoidElements
      blacklistedAttrs={[/^on/i, "style"]}
      blacklistedTags={[
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "link",
        "meta",
      ]}
      className={className}
      components={resolvedComponents}
      componentsOnly
      jsx={resolvedJsx}
      bindings={resolvedBindings}
      onError={(error) => {
        context.setError(error);
        resolvedOnError?.(error);
      }}
      renderError={renderError}
      renderInWrapper={false}
      showWarnings={false}
      {...props}
    />
  );
}

export type JSXPreviewErrorProps = ComponentProps<"div"> & {
  children?: ReactNode | ((error: Error) => ReactNode);
};

export function JSXPreviewError({
  className,
  children,
  ...props
}: JSXPreviewErrorProps) {
  const { error } = useJSXPreview();
  if (!error) return null;

  return (
    <div
      className={cn(
        "rounded-md border border-destructive/30 bg-background p-3 text-sm text-muted-foreground",
        className,
      )}
      role="alert"
      {...props}
    >
      {typeof children === "function" ? children(error) : children}
      {children ? null : error.message}
    </div>
  );
}

function findJsxStructureError(value: string): Error | null {
  const lastOpen = value.lastIndexOf("<");
  const lastClose = value.lastIndexOf(">");
  if (lastOpen > lastClose) {
    return new Error("Incomplete JSX tag.");
  }

  const stack: string[] = [];
  const tagPattern = /<\/?([A-Za-z][\w.-]*)(?:\s[^<>]*)?\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(value))) {
    const [raw, name] = match;
    const tagName = name.toLowerCase();
    if (raw.startsWith("</")) {
      const last = stack.pop();
      if (last !== name) {
        return new Error(`Unexpected closing tag </${name}>.`);
      }
      continue;
    }
    if (raw.endsWith("/>") || VOID_TAGS.has(tagName)) continue;
    stack.push(name);
  }

  const unclosed = stack.at(-1);
  return unclosed ? new Error(`Unclosed JSX tag <${unclosed}>.`) : null;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function completeStreamingJsx(value: string) {
  const lastOpen = value.lastIndexOf("<");
  const lastClose = value.lastIndexOf(">");
  const balancedPrefix =
    lastOpen > lastClose ? value.slice(0, lastOpen) : value;
  const stack: string[] = [];
  const tagPattern = /<\/?([A-Za-z][\w.-]*)(?:\s[^<>]*)?\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(balancedPrefix))) {
    const [raw, name] = match;
    const tagName = name.toLowerCase();
    if (raw.startsWith("</")) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index, stack.length - index);
      continue;
    }
    if (raw.endsWith("/>") || VOID_TAGS.has(tagName)) continue;
    stack.push(name);
  }

  return `${balancedPrefix}${stack
    .reverse()
    .map((name) => `</${name}>`)
    .join("")}`;
}
