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
import { PromoteGenUIButton } from "@/components/workbench/genui/PromoteGenUIButton";

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
import { usePromoteJsonRender } from "./use-promote-json-render";

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
    "result.list": (({ props }) => (
      <section
        aria-label={props.title}
        className="grid gap-3 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
        data-testid="json-render-result-list"
      >
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            {props.title}
          </h3>
          {props.summary ? (
            <p className="text-sm text-muted-foreground">{props.summary}</p>
          ) : null}
        </div>
        {props.items.length > 0 ? (
          <div className="grid gap-2">
            {props.items.map((item) => (
              <article
                className="grid gap-2 rounded border border-border/70 bg-background p-3"
                data-result-list-variant={item.variant}
                key={item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-medium text-foreground">
                        {item.title}
                      </h4>
                      {item.statusLabel ? (
                        <span
                          className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${resultListToneClass(
                            item.statusTone,
                          )}`}
                        >
                          {item.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {item.summary ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.summary}
                      </p>
                    ) : null}
                  </div>
                  <ResultListActions item={item} actionState={actionState} />
                </div>
                {item.meta?.length ? (
                  <dl className="grid gap-1 sm:grid-cols-2">
                    {item.meta.map((meta) => (
                      <div className="flex gap-1.5" key={meta.label}>
                        <dt className="text-xs font-medium text-muted-foreground">
                          {meta.label}
                        </dt>
                        <dd className="text-xs text-foreground">
                          {String(meta.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {item.evidence?.length ? (
                  <div className="grid gap-1 border-l-2 border-border pl-2">
                    {item.evidence.map((evidence, index) => (
                      <p
                        className="text-xs text-muted-foreground"
                        key={`${evidence.label ?? "evidence"}-${index}`}
                      >
                        {evidence.label ? (
                          <span className="font-medium text-foreground">
                            {evidence.label}:{" "}
                          </span>
                        ) : null}
                        {evidence.text}
                      </p>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : props.emptyState ? (
          <div className="rounded border border-dashed border-border p-3">
            <p className="text-sm font-medium text-foreground">
              {props.emptyState.title}
            </p>
            {props.emptyState.summary ? (
              <p className="text-sm text-muted-foreground">
                {props.emptyState.summary}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    )) satisfies ThreadJsonRenderComponentFn<"result.list">,
  } satisfies Partial<Components<typeof threadJsonRenderCatalog>>;
}

function ResultListActions({
  item,
  actionState,
}: {
  item: Parameters<
    ThreadJsonRenderComponentFn<"result.list">
  >[0]["props"]["items"][number];
  actionState: DurableActionState;
}) {
  const actionIds = [item.primaryActionId, item.secondaryActionId].filter(
    (actionId): actionId is string => Boolean(actionId),
  );
  if (actionIds.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {actionIds.map((actionId) => {
        const action = actionState.actions.find((item) => item.id === actionId);
        if (!action) return null;
        const status = actionState.statusForAction(action);
        const disabled =
          actionState.actionsDisabled ||
          action.disabled === true ||
          status.state === "submitting";

        return (
          <button
            className="rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            key={action.id}
            onClick={() => actionState.onAction(action)}
            type="button"
          >
            {status.state === "submitting" ? "Working..." : action.label}
          </button>
        );
      })}
    </div>
  );
}

function resultListToneClass(
  tone:
    | "neutral"
    | "info"
    | "success"
    | "warning"
    | "danger"
    | "muted"
    | null
    | undefined,
) {
  switch (tone) {
    case "info":
      return "bg-blue-50 text-blue-700";
    case "success":
      return "bg-emerald-50 text-emerald-700";
    case "warning":
      return "bg-amber-50 text-amber-800";
    case "danger":
      return "bg-red-50 text-red-700";
    case "muted":
      return "bg-muted text-muted-foreground";
    case "neutral":
    default:
      return "bg-secondary text-secondary-foreground";
  }
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
  const promotion = usePromoteJsonRender({
    data,
    partId,
    sourceMessageId,
    threadId,
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

  const rendered = (
    <JSONUIProvider registry={registry}>
      <Renderer
        fallback={rendererFallback}
        registry={registry}
        spec={data.spec as never}
      />
    </JSONUIProvider>
  );

  return (
    <div className="group/json-render relative min-w-0 w-full">
      <div className="absolute right-1 top-1 z-10 opacity-0 transition-opacity group-hover/json-render:opacity-100 group-focus-within/json-render:opacity-100">
        <PromoteGenUIButton
          disabled={!promotion.canPromote}
          onPromote={promotion.promote}
          status={promotion.status}
        />
      </div>
      {rendered}
    </div>
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
