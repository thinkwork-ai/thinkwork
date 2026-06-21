import { Component, useRef, type ErrorInfo, type ReactNode } from "react";
import {
  createAnalyticsDisplayGenUIValidationContext,
  THREAD_GENUI_ANALYTICS_COMPONENT,
  validateThreadGenUIData,
  type ThreadGenUIActionDescriptor,
  type ThreadGenUIData,
  type ThreadGenUIDiagnostic,
  type ThreadGenUIElement,
} from "@thinkwork/genui";
import { AnalyticsDisplayPart } from "./components/AnalyticsDisplayPart";
import { ActionForm, type ActionFormField } from "./components/ActionForm";
import {
  TaskReviewCard,
  type TaskReviewCardProps,
} from "./components/TaskReviewCard";
import {
  TaskStatusSummary,
  type WorkflowStep,
} from "./components/TaskStatusSummary";
import {
  WorkflowListPreview,
  type KeyValueListItem,
} from "./components/WorkflowListPreview";
import { GenUIFallback } from "./GenUIFallback";
import { canSubmitGenUIAction } from "./actions";
import { PromoteGenUIButton } from "./PromoteGenUIButton";
import { useGenUIAction, type GenUIActionStatus } from "./use-genui-action";
import { usePromoteGenUI } from "./use-promote-genui";

export interface GenUIRendererProps {
  data: unknown;
  partId?: string;
  sourceMessageId?: string;
  threadId?: string;
  live?: boolean;
}

export function GenUIRenderer({
  data,
  partId,
  sourceMessageId,
  threadId,
  live = false,
}: GenUIRendererProps) {
  const lastGood = useRef<ThreadGenUIData | null>(null);
  const result = validateThreadGenUIData(
    data,
    createAnalyticsDisplayGenUIValidationContext(),
  );

  if (!result.ok) {
    if (live && lastGood.current) {
      return (
        <div className="grid gap-2" data-testid="genui-last-good">
          <GenUIErrorBoundary fallbackData={lastGood.current}>
            <ValidatedGenUIRenderer
              data={lastGood.current}
              live={live}
              partId={partId}
              sourceMessageId={sourceMessageId}
              threadId={threadId}
            />
          </GenUIErrorBoundary>
          <GenUIFallback
            component={rootComponentName(data)}
            diagnostics={result.diagnostics}
            fallback={mobileFallbackFor(data)}
            rejectedUpdate
          />
        </div>
      );
    }

    return (
      <GenUIFallback
        component={rootComponentName(data)}
        diagnostics={result.diagnostics}
        fallback={mobileFallbackFor(data)}
      />
    );
  }

  lastGood.current = result.data;
  return wrapPart(
    partId,
    <GenUIErrorBoundary fallbackData={result.data}>
      <ValidatedGenUIRenderer
        data={result.data}
        live={live}
        partId={partId}
        sourceMessageId={sourceMessageId}
        threadId={threadId}
      />
    </GenUIErrorBoundary>,
  );
}

export interface GenUIErrorBoundaryProps {
  children: ReactNode;
  fallbackData?: ThreadGenUIData;
}

interface GenUIErrorBoundaryState {
  error?: Error;
}

export class GenUIErrorBoundary extends Component<
  GenUIErrorBoundaryProps,
  GenUIErrorBoundaryState
> {
  state: GenUIErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): GenUIErrorBoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // React still reports the component stack in development; the rendered UI
    // stays compact and recoverable for the Thread transcript.
  }

  componentDidUpdate(prevProps: GenUIErrorBoundaryProps) {
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
      <GenUIFallback
        component={rootComponentName(this.props.fallbackData)}
        diagnostics={[
          {
            code: "GENUI_RENDER_ERROR",
            message: "Generated UI renderer failed.",
            severity: "error",
          },
        ]}
        fallback={this.props.fallbackData?.mobileFallback}
      />
    );
  }
}

function ValidatedGenUIRenderer({
  data,
  live,
  partId,
  sourceMessageId,
  threadId,
}: {
  data: ThreadGenUIData;
  live: boolean;
  partId?: string;
  sourceMessageId?: string;
  threadId?: string;
}) {
  const { submitAction, statusForAction } = useGenUIAction({
    data,
    partId,
    sourceMessageId,
    threadId,
  });
  const promotion = usePromoteGenUI({
    data,
    partId,
    sourceMessageId,
    threadId,
  });
  const element = data.spec.elements[data.spec.root];
  if (!element) {
    return (
      <GenUIFallback
        diagnostics={[
          {
            code: "GENUI_ROOT_MISSING",
            message: "Generated UI root element is missing.",
            severity: "error",
          },
        ]}
        fallback={data.mobileFallback}
      />
    );
  }

  const actionsDisabled =
    live ||
    !canSubmitGenUIAction({
      data,
      partId,
      sourceMessageId,
      threadId,
    });
  const rendered = renderElement({
    element,
    data,
    actions: data.actions ?? [],
    actionsDisabled,
    onAction: submitAction,
    statusForAction,
  });
  if (!promotion.canPromote || live) return rendered;
  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <PromoteGenUIButton
          status={promotion.status}
          onPromote={promotion.promote}
        />
      </div>
      {rendered}
    </div>
  );
}

function renderElement({
  element,
  data,
  actions,
  actionsDisabled,
  onAction,
  statusForAction,
}: {
  element: ThreadGenUIElement;
  data: ThreadGenUIData;
  actions: ThreadGenUIActionDescriptor[];
  actionsDisabled: boolean;
  onAction: (action: ThreadGenUIActionDescriptor) => void;
  statusForAction: (action: ThreadGenUIActionDescriptor) => GenUIActionStatus;
}) {
  switch (element.component) {
    case THREAD_GENUI_ANALYTICS_COMPONENT:
      return <AnalyticsDisplayPart data={data} />;
    case "task.review":
      return (
        <TaskReviewCard
          {...(element.props as unknown as TaskReviewCardProps)}
          actions={actions}
          actionsDisabled={actionsDisabled}
          onAction={onAction}
          statusForAction={statusForAction}
        />
      );
    case "workflow.status":
      return (
        <TaskStatusSummary
          {...(element.props as {
            title: string;
            status: WorkflowStep["status"];
            steps?: WorkflowStep[];
          })}
        />
      );
    case "keyValue.list":
      return (
        <WorkflowListPreview
          {...(element.props as { title?: string; items?: KeyValueListItem[] })}
        />
      );
    case "form.action":
      return (
        <ActionForm
          {...(element.props as {
            title: string;
            description?: string;
            fields?: ActionFormField[];
            submitActionId?: string;
          })}
          actions={actions}
          actionsDisabled={actionsDisabled}
          onAction={onAction}
          statusForAction={statusForAction}
        />
      );
    default:
      return (
        <GenUIFallback
          component={element.component}
          diagnostics={[
            {
              code: "GENUI_COMPONENT_UNSUPPORTED",
              message: `Unsupported Thread GenUI component ${element.component}.`,
              severity: "error",
            },
          ]}
          fallback={data.mobileFallback}
        />
      );
  }
}

function rootComponentName(data?: unknown): string | undefined {
  if (!isRecord(data) || !isRecord(data.spec)) return undefined;
  const root = typeof data.spec.root === "string" ? data.spec.root : undefined;
  if (!root || !isRecord(data.spec.elements)) return undefined;
  const element = data.spec.elements[root];
  return isRecord(element) && typeof element.component === "string"
    ? element.component
    : undefined;
}

function mobileFallbackFor(
  data: unknown,
): ThreadGenUIData["mobileFallback"] | undefined {
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
    <div className="min-w-0" data-genui-part-id={partId}>
      {node}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
