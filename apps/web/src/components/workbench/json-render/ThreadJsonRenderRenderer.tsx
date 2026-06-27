import {
  Component,
  useMemo,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
  type ComponentFn,
  type ComponentRenderer,
  type Components,
} from "@json-render/react";

import {
  ActionForm,
  type ActionFormField,
} from "@/components/workbench/genui/components/ActionForm";
import { TaskReviewCard } from "@/components/workbench/genui/components/TaskReviewCard";
import { TaskStatusSummary } from "@/components/workbench/genui/components/TaskStatusSummary";
import { WorkflowListPreview } from "@/components/workbench/genui/components/WorkflowListPreview";

import {
  threadJsonRenderCatalog,
  threadJsonRenderPrimitiveComponents,
} from "./catalog";
import { ThreadJsonRenderFallback } from "./ThreadJsonRenderFallback";
import { canSubmitJsonRenderAction } from "./actions";
import {
  validateThreadJsonRenderData,
  type ThreadJsonRenderData,
  type ThreadJsonRenderDurableActionDescriptor,
} from "./validation";
import {
  useJsonRenderAction,
  type JsonRenderActionSuccessHandler,
  type JsonRenderActionStatus,
} from "./use-json-render-action";

type ThreadJsonRenderComponentFn<
  K extends keyof Components<typeof threadJsonRenderCatalog>,
> = ComponentFn<typeof threadJsonRenderCatalog, K>;

export interface ThreadJsonRenderRendererProps {
  data: unknown;
  partId?: string;
  live?: boolean;
  sourceMessageId?: string | null;
  threadId?: string | null;
  onActionSuccess?: JsonRenderActionSuccessHandler;
}

interface DurableActionState {
  actions: ThreadJsonRenderDurableActionDescriptor[];
  actionsDisabled: boolean;
  onAction: (action: ThreadJsonRenderDurableActionDescriptor) => void;
  statusForAction: (
    action: ThreadJsonRenderDurableActionDescriptor,
  ) => JsonRenderActionStatus;
}

function createDomainComponents(actionState: DurableActionState) {
  return {
    "task.review": (({ props }) => (
      <TaskReviewCard
        {...props}
        assigneeLabel={props.assigneeLabel ?? undefined}
        priority={props.priority ?? undefined}
        primaryActionId={props.primaryActionId ?? undefined}
        actions={actionState.actions}
        actionsDisabled={actionState.actionsDisabled}
        onAction={actionState.onAction}
        statusForAction={actionState.statusForAction}
      />
    )) satisfies ThreadJsonRenderComponentFn<"task.review">,
    "workflow.status": (({ props }) => (
      <TaskStatusSummary {...props} />
    )) satisfies ThreadJsonRenderComponentFn<"workflow.status">,
    "keyValue.list": (({ props }) => (
      <WorkflowListPreview {...props} />
    )) satisfies ThreadJsonRenderComponentFn<"keyValue.list">,
    "form.action": (({ props }) => (
      <ActionForm
        {...props}
        fields={normalizeActionFormFields(props.fields)}
        submitActionId={props.submitActionId ?? undefined}
        actions={actionState.actions}
        actionsDisabled={actionState.actionsDisabled}
        onAction={actionState.onAction}
        statusForAction={actionState.statusForAction}
      />
    )) satisfies ThreadJsonRenderComponentFn<"form.action">,
    "analytics.display": (({ props }) => (
      <section
        aria-label={analyticsTitle(props)}
        className="grid gap-2 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
        data-testid="json-render-analytics-display"
      >
        <h3 className="text-sm font-semibold text-foreground">
          {analyticsTitle(props)}
        </h3>
        <p className="text-sm text-muted-foreground">
          Analytical display rendering is handled by the ThinkWork analytics
          adapter.
        </p>
      </section>
    )) satisfies ThreadJsonRenderComponentFn<"analytics.display">,
  } satisfies Partial<Components<typeof threadJsonRenderCatalog>>;
}

function normalizeActionFormFields(
  fields:
    | Array<{
        id: string;
        label: string;
        type: "text" | "textarea" | "select" | "checkbox";
        required?: boolean;
        options?: string[];
      }>
    | undefined,
): ActionFormField[] | undefined {
  return fields?.map((field) => ({
    ...field,
    type: field.type === "checkbox" ? "text" : field.type,
  }));
}

function analyticsTitle(props: Record<string, unknown>) {
  return typeof props.title === "string" ? props.title : "Analytics display";
}

const rendererFallback: ComponentRenderer = ({ element }) => (
  <ThreadJsonRenderFallback
    component={element.type}
    diagnostics={[
      {
        code: "JSON_RENDER_COMPONENT_RENDERER_MISSING",
        message: `Unsupported Thread json-render component ${element.type}.`,
        severity: "error",
      },
    ]}
  />
);

export function ThreadJsonRenderRenderer({
  data,
  partId,
  live = false,
  sourceMessageId,
  threadId,
  onActionSuccess,
}: ThreadJsonRenderRendererProps) {
  const lastGood = useRef<ThreadJsonRenderData | null>(null);
  const result = validateThreadJsonRenderData(data);

  if (!result.ok) {
    if (live && lastGood.current) {
      return (
        <div className="grid gap-2" data-testid="json-render-last-good">
          <ThreadJsonRenderErrorBoundary fallbackData={lastGood.current}>
            <ValidatedThreadJsonRenderRenderer
              data={lastGood.current}
              live={live}
              partId={partId}
              sourceMessageId={sourceMessageId}
              threadId={threadId}
              onActionSuccess={onActionSuccess}
            />
          </ThreadJsonRenderErrorBoundary>
          <ThreadJsonRenderFallback
            component={rootComponentName(data)}
            diagnostics={result.diagnostics}
            fallback={mobileFallbackFor(data)}
            rejectedUpdate
          />
        </div>
      );
    }

    return (
      <ThreadJsonRenderFallback
        component={rootComponentName(data)}
        diagnostics={result.diagnostics}
        fallback={mobileFallbackFor(data)}
      />
    );
  }

  lastGood.current = result.data;
  return wrapPart(
    partId,
    <ThreadJsonRenderErrorBoundary fallbackData={result.data}>
      <ValidatedThreadJsonRenderRenderer
        data={result.data}
        live={live}
        partId={partId}
        sourceMessageId={sourceMessageId}
        threadId={threadId}
        onActionSuccess={onActionSuccess}
      />
    </ThreadJsonRenderErrorBoundary>,
  );
}

function ValidatedThreadJsonRenderRenderer({
  data,
  live,
  partId,
  sourceMessageId,
  threadId,
  onActionSuccess,
}: {
  data: ThreadJsonRenderData;
  live: boolean;
  partId?: string;
  sourceMessageId?: string | null;
  threadId?: string | null;
  onActionSuccess?: JsonRenderActionSuccessHandler;
}) {
  if (live || !partId || !threadId || !sourceMessageId) {
    return <ReadOnlyThreadJsonRenderRenderer data={data} />;
  }

  return (
    <InteractiveThreadJsonRenderRenderer
      data={data}
      partId={partId}
      sourceMessageId={sourceMessageId}
      threadId={threadId}
      onActionSuccess={onActionSuccess}
    />
  );
}

function ReadOnlyThreadJsonRenderRenderer({
  data,
}: {
  data: ThreadJsonRenderData;
}) {
  const registry = useMemo(() => {
    const { registry: generatedRegistry } = defineRegistry(
      threadJsonRenderCatalog,
      {
        components: {
          ...threadJsonRenderPrimitiveComponents,
          ...createDomainComponents({
            actions: data.durableActions ?? [],
            actionsDisabled: true,
            onAction: () => undefined,
            statusForAction: () => ({ state: "idle" }),
          }),
        },
      },
    );
    return generatedRegistry;
  }, [data.durableActions]);

  return (
    <JSONUIProvider registry={registry}>
      <Renderer
        fallback={rendererFallback}
        registry={registry}
        spec={data.spec as never}
      />
    </JSONUIProvider>
  );
}

function InteractiveThreadJsonRenderRenderer({
  data,
  partId,
  sourceMessageId,
  threadId,
  onActionSuccess,
}: {
  data: ThreadJsonRenderData;
  partId: string;
  sourceMessageId: string;
  threadId: string;
  onActionSuccess?: JsonRenderActionSuccessHandler;
}) {
  const { submitAction, statusForAction } = useJsonRenderAction({
    data,
    partId,
    sourceMessageId,
    threadId,
    onActionSuccess,
  });
  const actions = data.durableActions ?? [];
  const actionsDisabled =
    actions.length === 0 ||
    !canSubmitJsonRenderAction({ data, partId, sourceMessageId, threadId });
  const registry = useMemo(() => {
    const { registry: generatedRegistry } = defineRegistry(
      threadJsonRenderCatalog,
      {
        components: {
          ...threadJsonRenderPrimitiveComponents,
          ...createDomainComponents({
            actions,
            actionsDisabled,
            onAction: submitAction,
            statusForAction,
          }),
        },
      },
    );
    return generatedRegistry;
  }, [actions, actionsDisabled, statusForAction, submitAction]);

  return (
    <JSONUIProvider registry={registry}>
      <Renderer
        fallback={rendererFallback}
        registry={registry}
        spec={data.spec as never}
      />
    </JSONUIProvider>
  );
}

interface ThreadJsonRenderErrorBoundaryProps {
  children: ReactNode;
  fallbackData?: ThreadJsonRenderData;
}

interface ThreadJsonRenderErrorBoundaryState {
  error?: Error;
}

export class ThreadJsonRenderErrorBoundary extends Component<
  ThreadJsonRenderErrorBoundaryProps,
  ThreadJsonRenderErrorBoundaryState
> {
  state: ThreadJsonRenderErrorBoundaryState = {};

  static getDerivedStateFromError(
    error: Error,
  ): ThreadJsonRenderErrorBoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Keep the Thread transcript compact and recoverable.
  }

  componentDidUpdate(prevProps: ThreadJsonRenderErrorBoundaryProps) {
    if (
      this.state.error &&
      prevProps.fallbackData !== this.props.fallbackData
    ) {
      this.setState({ error: undefined });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ThreadJsonRenderFallback
        component={rootComponentName(this.props.fallbackData)}
        diagnostics={[
          {
            code: "JSON_RENDER_RENDER_ERROR",
            message: "Generated UI renderer failed.",
            severity: "error",
          },
        ]}
        fallback={this.props.fallbackData?.mobileFallback}
      />
    );
  }
}

function rootComponentName(data?: unknown): string | undefined {
  if (!isRecord(data) || !isRecord(data.spec)) return undefined;
  const root = typeof data.spec.root === "string" ? data.spec.root : undefined;
  if (!root || !isRecord(data.spec.elements)) return undefined;
  const element = data.spec.elements[root];
  return isRecord(element) && typeof element.type === "string"
    ? element.type
    : undefined;
}

function mobileFallbackFor(
  data: unknown,
): ThreadJsonRenderData["mobileFallback"] | undefined {
  if (!isRecord(data) || !isRecord(data.mobileFallback)) return undefined;
  const { title, summary, lines } = data.mobileFallback;
  if (typeof title !== "string" || typeof summary !== "string") {
    return undefined;
  }
  return {
    title,
    summary,
    lines: Array.isArray(lines)
      ? lines.filter((line): line is string => typeof line === "string")
      : undefined,
  };
}

function wrapPart(partId: string | undefined, node: ReactNode): ReactNode {
  if (!partId) return node;
  return (
    <div className="min-w-0 w-full" data-json-render-part-id={partId}>
      {node}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
