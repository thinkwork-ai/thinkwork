import { isThreadGenUIActionKind } from "./actions.js";
import {
  isAnalyticalComponentName,
  isNativeGenUIComponent,
  isReservedAdapterComponent,
} from "./catalog.js";
import { genUIError } from "./diagnostics.js";
import { createThreadGenUISpecHash } from "./hash.js";
import { threadGenUILimits } from "./limits.js";
import {
  THREAD_GENUI_CATALOG_VERSION,
  THREAD_GENUI_PART_TYPE,
  THREAD_GENUI_SCHEMA_VERSION,
  THREAD_GENUI_STATUS_VALUES,
  type ThreadGenUIActionDescriptor,
  type ThreadGenUIData,
  type ThreadGenUIDataValidationResult,
  type ThreadGenUIDiagnostic,
  type ThreadGenUIElement,
  type ThreadGenUIMobileFallback,
  type ThreadGenUIPart,
  type ThreadGenUIValidationContext,
  type ThreadGenUIValidationResult,
} from "./spec.js";

const envelopeKeys = new Set([
  "schemaVersion",
  "catalogVersion",
  "spec",
  "status",
  "mobileFallback",
  "diagnostic",
  "diagnostics",
  "actions",
  "promotion",
  "specHash",
]);
const specKeys = new Set(["root", "elements"]);
const elementKeys = new Set(["component", "props", "children"]);
const diagnosticKeys = new Set(["code", "message", "path", "severity"]);
const mobileFallbackKeys = new Set(["title", "summary", "lines"]);
const actionKeys = new Set([
  "id",
  "label",
  "kind",
  "params",
  "disabled",
  "destructive",
]);
const promotionKeys = new Set([
  "artifactTitle",
  "artifactSummary",
  "sourceMessageId",
]);
const taskReviewPropsKeys = new Set([
  "title",
  "summary",
  "status",
  "priority",
  "assigneeLabel",
  "primaryActionId",
]);
const workflowStatusPropsKeys = new Set(["title", "status", "steps"]);
const workflowStepKeys = new Set(["id", "title", "status", "summary"]);
const keyValueListPropsKeys = new Set(["title", "items"]);
const keyValueItemKeys = new Set(["label", "value"]);
const formActionPropsKeys = new Set([
  "title",
  "description",
  "fields",
  "submitActionId",
]);
const formFieldKeys = new Set(["id", "label", "type", "required", "options"]);
const forbiddenKeys = new Set([
  "backgroundColor",
  "callback",
  "className",
  "code",
  "dangerouslySetInnerHTML",
  "endpoint",
  "fetch",
  "href",
  "html",
  "image",
  "mediaUrl",
  "onClick",
  "renderer",
  "script",
  "src",
  "style",
  "url",
]);
const statusSet = new Set<string>(THREAD_GENUI_STATUS_VALUES);
const adapterHint =
  "Use the analytics.display adapter from packages/analytics-display in U8.";

export function isPotentialThreadGenUIData(input: unknown): boolean {
  return (
    isRecord(input) &&
    input.schemaVersion === THREAD_GENUI_SCHEMA_VERSION &&
    input.catalogVersion === THREAD_GENUI_CATALOG_VERSION &&
    isRecord(input.spec) &&
    isRecord(input.mobileFallback)
  );
}

export function validateThreadGenUIPart(
  input: unknown,
  context: ThreadGenUIValidationContext = {},
): ThreadGenUIValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        genUIError(
          "GENUI_PART_NOT_OBJECT",
          "Thread GenUI part must be an object.",
          "$",
        ),
      ],
    };
  }

  const diagnostics: ThreadGenUIDiagnostic[] = [];

  if (input.type !== THREAD_GENUI_PART_TYPE) {
    diagnostics.push(
      genUIError(
        "GENUI_PART_TYPE_INVALID",
        "Thread GenUI part type must be data-genui.",
        "$.type",
      ),
    );
  }

  if (typeof input.id !== "string" || input.id.length === 0) {
    diagnostics.push(
      genUIError(
        "GENUI_PART_ID_REQUIRED",
        "Thread GenUI part id is required.",
        "$.id",
      ),
    );
  }

  const dataResult = validateThreadGenUIData(input.data, context);
  if (!dataResult.ok) diagnostics.push(...dataResult.diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    part: {
      type: THREAD_GENUI_PART_TYPE,
      id: input.id as string,
      data: dataResult.ok ? dataResult.data : (input.data as ThreadGenUIData),
    },
  };
}

export function validateThreadGenUIData(
  input: unknown,
  context: ThreadGenUIValidationContext = {},
): ThreadGenUIDataValidationResult {
  const diagnostics: ThreadGenUIDiagnostic[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        genUIError(
          "GENUI_DATA_NOT_OBJECT",
          "Thread GenUI data must be an object.",
          "$.data",
        ),
      ],
    };
  }

  validateSerializedSize(input, "$.data", diagnostics);
  validateUnknownKeys(input, envelopeKeys, "$.data", diagnostics);
  collectForbiddenFieldDiagnostics(input, "$.data", diagnostics);

  if (input.schemaVersion !== THREAD_GENUI_SCHEMA_VERSION) {
    diagnostics.push(
      genUIError(
        "GENUI_SCHEMA_VERSION_UNSUPPORTED",
        `Unsupported Thread GenUI schemaVersion. Expected ${THREAD_GENUI_SCHEMA_VERSION}.`,
        "$.data.schemaVersion",
      ),
    );
  }

  if (input.catalogVersion !== THREAD_GENUI_CATALOG_VERSION) {
    diagnostics.push(
      genUIError(
        "GENUI_CATALOG_VERSION_UNSUPPORTED",
        `Unsupported Thread GenUI catalogVersion. Expected ${THREAD_GENUI_CATALOG_VERSION}.`,
        "$.data.catalogVersion",
      ),
    );
  }

  if (!statusSet.has(String(input.status))) {
    diagnostics.push(
      genUIError(
        "GENUI_STATUS_INVALID",
        "Thread GenUI status is unsupported.",
        "$.data.status",
      ),
    );
  }

  validateMobileFallback(input.mobileFallback, diagnostics);
  validateDiagnostics(input.diagnostic, "$.data.diagnostic", diagnostics);
  if (input.diagnostics != null) {
    if (!Array.isArray(input.diagnostics)) {
      diagnostics.push(
        genUIError(
          "GENUI_DIAGNOSTICS_INVALID",
          "Thread GenUI diagnostics must be an array.",
          "$.data.diagnostics",
        ),
      );
    } else {
      input.diagnostics.forEach((diagnostic, index) =>
        validateDiagnostics(
          diagnostic,
          `$.data.diagnostics[${index}]`,
          diagnostics,
        ),
      );
    }
  }
  validateActions(input.actions, diagnostics);
  validatePromotion(input.promotion, diagnostics);

  const actionIds = new Set(
    Array.isArray(input.actions)
      ? input.actions
          .filter((action): action is ThreadGenUIActionDescriptor =>
            isRecord(action),
          )
          .map((action) => action.id)
          .filter((id): id is string => typeof id === "string")
      : [],
  );

  if (isRecord(input.spec)) {
    validateSpec(input.spec, actionIds, context, diagnostics);
  } else {
    diagnostics.push(
      genUIError(
        "GENUI_SPEC_REQUIRED",
        "Thread GenUI data must include spec.",
        "$.data.spec",
      ),
    );
  }

  if (
    typeof input.specHash === "string" &&
    isRecord(input.spec) &&
    input.specHash !== createThreadGenUISpecHash(input.spec)
  ) {
    diagnostics.push(
      genUIError(
        "GENUI_SPEC_HASH_MISMATCH",
        "Thread GenUI specHash does not match the canonical spec.",
        "$.data.specHash",
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  return { ok: true, data: input as unknown as ThreadGenUIData };
}

export function createThreadGenUIDiagnosticData(
  diagnostic: ThreadGenUIDiagnostic,
  fallback: ThreadGenUIMobileFallback = {
    title: "Unsupported generated UI",
    summary: "This generated UI cannot be displayed.",
  },
): ThreadGenUIData {
  const spec = {
    root: "fallback",
    elements: {
      fallback: {
        component: "keyValue.list",
        props: {
          title: fallback.title,
          items: [
            {
              label: "Reason",
              value: diagnostic.message,
            },
          ],
        },
      },
    },
  } satisfies ThreadGenUIData["spec"];

  return {
    schemaVersion: THREAD_GENUI_SCHEMA_VERSION,
    catalogVersion: THREAD_GENUI_CATALOG_VERSION,
    spec,
    status: "invalid",
    diagnostic,
    diagnostics: [diagnostic],
    mobileFallback: fallback,
    specHash: createThreadGenUISpecHash(spec),
  };
}

function validateSpec(
  spec: Record<string, unknown>,
  actionIds: Set<string>,
  context: ThreadGenUIValidationContext,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  validateUnknownKeys(spec, specKeys, "$.data.spec", diagnostics);

  if (typeof spec.root !== "string" || spec.root.length === 0) {
    diagnostics.push(
      genUIError(
        "GENUI_SPEC_ROOT_REQUIRED",
        "Thread GenUI spec.root is required.",
        "$.data.spec.root",
      ),
    );
  }

  if (!isRecord(spec.elements)) {
    diagnostics.push(
      genUIError(
        "GENUI_SPEC_ELEMENTS_REQUIRED",
        "Thread GenUI spec.elements must be an object.",
        "$.data.spec.elements",
      ),
    );
    return;
  }

  const elementEntries = Object.entries(spec.elements);
  if (elementEntries.length === 0) {
    diagnostics.push(
      genUIError(
        "GENUI_SPEC_ELEMENTS_EMPTY",
        "Thread GenUI spec.elements cannot be empty.",
        "$.data.spec.elements",
      ),
    );
  }
  if (elementEntries.length > threadGenUILimits.maxElements) {
    diagnostics.push(
      genUIError(
        "GENUI_TOO_MANY_ELEMENTS",
        `Thread GenUI spec has more than ${threadGenUILimits.maxElements} elements.`,
        "$.data.spec.elements",
      ),
    );
  }
  if (typeof spec.root === "string" && !(spec.root in spec.elements)) {
    diagnostics.push(
      genUIError(
        "GENUI_SPEC_ROOT_MISSING",
        "Thread GenUI spec.root must reference an element id.",
        "$.data.spec.root",
      ),
    );
  }

  for (const [elementId, element] of elementEntries) {
    validateElement(
      elementId,
      element,
      actionIds,
      context,
      `$.data.spec.elements.${elementId}`,
      diagnostics,
    );
  }

  if (typeof spec.root === "string") {
    validateDepth(spec.root, spec.elements, diagnostics);
  }
}

function validateElement(
  elementId: string,
  element: unknown,
  actionIds: Set<string>,
  context: ThreadGenUIValidationContext,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (!isRecord(element)) {
    diagnostics.push(
      genUIError(
        "GENUI_ELEMENT_INVALID",
        "Thread GenUI element must be an object.",
        path,
      ),
    );
    return;
  }

  validateUnknownKeys(element, elementKeys, path, diagnostics);
  if (typeof element.component !== "string" || element.component.length === 0) {
    diagnostics.push(
      genUIError(
        "GENUI_COMPONENT_REQUIRED",
        "Thread GenUI element.component is required.",
        `${path}.component`,
      ),
    );
    return;
  }

  if (!isRecord(element.props)) {
    diagnostics.push(
      genUIError(
        "GENUI_PROPS_INVALID",
        "Thread GenUI element.props must be an object.",
        `${path}.props`,
      ),
    );
    return;
  }

  if (
    element.children != null &&
    (!Array.isArray(element.children) ||
      !element.children.every((child) => typeof child === "string"))
  ) {
    diagnostics.push(
      genUIError(
        "GENUI_CHILDREN_INVALID",
        "Thread GenUI element.children must contain element ids.",
        `${path}.children`,
      ),
    );
  }

  if (isNativeGenUIComponent(element.component)) {
    validateNativeComponent(
      elementId,
      element.component,
      element.props,
      actionIds,
      `${path}.props`,
      diagnostics,
    );
    return;
  }

  if (isReservedAdapterComponent(element.component)) {
    const allowed = new Set(context.allowAdapterComponents ?? []);
    if (!allowed.has(element.component)) {
      diagnostics.push(
        genUIError(
          "GENUI_ANALYTICS_ADAPTER_MISSING",
          `${element.component} is reserved for a registered adapter. ${adapterHint}`,
          `${path}.component`,
        ),
      );
    }
    if (allowed.has(element.component)) {
      diagnostics.push(
        ...(context.validateAdapterElement?.(
          element.component,
          element as unknown as ThreadGenUIElement,
          path,
        ) ?? []),
      );
    }
    return;
  }

  if (isAnalyticalComponentName(element.component)) {
    diagnostics.push(
      genUIError(
        "GENUI_ANALYTICS_ADAPTER_MISSING",
        `Analytical component ${element.component} must use the analytics.display adapter. ${adapterHint}`,
        `${path}.component`,
      ),
    );
    return;
  }

  diagnostics.push(
    genUIError(
      "GENUI_COMPONENT_UNSUPPORTED",
      `Unsupported Thread GenUI component ${element.component}.`,
      `${path}.component`,
    ),
  );
}

function validateNativeComponent(
  elementId: string,
  component: string,
  props: Record<string, unknown>,
  actionIds: Set<string>,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  switch (component) {
    case "task.review":
      validateUnknownKeys(props, taskReviewPropsKeys, path, diagnostics);
      requireString(props, "title", path, diagnostics);
      requireString(props, "summary", path, diagnostics);
      requireEnum(
        props,
        "status",
        ["pending", "approved", "rejected", "needs_review"],
        path,
        diagnostics,
      );
      optionalActionReference(
        props,
        "primaryActionId",
        actionIds,
        path,
        diagnostics,
      );
      return;
    case "workflow.status":
      validateUnknownKeys(props, workflowStatusPropsKeys, path, diagnostics);
      requireString(props, "title", path, diagnostics);
      requireEnum(
        props,
        "status",
        ["queued", "running", "blocked", "completed", "failed"],
        path,
        diagnostics,
      );
      validateBoundedArray(
        props.steps,
        threadGenUILimits.maxWorkflowSteps,
        `${path}.steps`,
        diagnostics,
      );
      validateWorkflowSteps(props.steps, `${path}.steps`, diagnostics);
      return;
    case "keyValue.list":
      validateUnknownKeys(props, keyValueListPropsKeys, path, diagnostics);
      validateBoundedArray(
        props.items,
        threadGenUILimits.maxListItems,
        `${path}.items`,
        diagnostics,
      );
      validateKeyValueItems(props.items, `${path}.items`, diagnostics);
      return;
    case "form.action":
      validateUnknownKeys(props, formActionPropsKeys, path, diagnostics);
      requireString(props, "title", path, diagnostics);
      optionalActionReference(
        props,
        "submitActionId",
        actionIds,
        path,
        diagnostics,
      );
      validateBoundedArray(
        props.fields,
        threadGenUILimits.maxFormFields,
        `${path}.fields`,
        diagnostics,
      );
      validateFormFields(props.fields, `${path}.fields`, diagnostics);
      return;
    default:
      diagnostics.push(
        genUIError(
          "GENUI_COMPONENT_UNSUPPORTED",
          `Unsupported Thread GenUI component ${component} on ${elementId}.`,
          path,
        ),
      );
  }
}

function validateWorkflowSteps(
  input: unknown,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (!Array.isArray(input)) return;
  input.forEach((step, index) => {
    const stepPath = `${path}[${index}]`;
    if (!isRecord(step)) {
      diagnostics.push(
        genUIError(
          "GENUI_ARRAY_ITEM_INVALID",
          "Thread GenUI workflow steps must be objects.",
          stepPath,
        ),
      );
      return;
    }
    validateUnknownKeys(step, workflowStepKeys, stepPath, diagnostics);
    requireString(step, "id", stepPath, diagnostics);
    requireString(step, "title", stepPath, diagnostics);
    requireEnum(
      step,
      "status",
      ["queued", "running", "blocked", "completed", "failed"],
      stepPath,
      diagnostics,
    );
  });
}

function validateKeyValueItems(
  input: unknown,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (!Array.isArray(input)) return;
  input.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push(
        genUIError(
          "GENUI_ARRAY_ITEM_INVALID",
          "Thread GenUI key-value items must be objects.",
          itemPath,
        ),
      );
      return;
    }
    validateUnknownKeys(item, keyValueItemKeys, itemPath, diagnostics);
    requireString(item, "label", itemPath, diagnostics);
    if (!isPrimitive(item.value)) {
      diagnostics.push(
        genUIError(
          "GENUI_PRIMITIVE_REQUIRED",
          "Thread GenUI key-value item values must be JSON primitives.",
          `${itemPath}.value`,
        ),
      );
    }
  });
}

function validateFormFields(
  input: unknown,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (!Array.isArray(input)) return;
  input.forEach((field, index) => {
    const fieldPath = `${path}[${index}]`;
    if (!isRecord(field)) {
      diagnostics.push(
        genUIError(
          "GENUI_ARRAY_ITEM_INVALID",
          "Thread GenUI form fields must be objects.",
          fieldPath,
        ),
      );
      return;
    }
    validateUnknownKeys(field, formFieldKeys, fieldPath, diagnostics);
    requireString(field, "id", fieldPath, diagnostics);
    requireString(field, "label", fieldPath, diagnostics);
    requireEnum(
      field,
      "type",
      ["text", "textarea", "select"],
      fieldPath,
      diagnostics,
    );
    if (field.options != null) {
      validateBoundedArray(
        field.options,
        threadGenUILimits.maxFieldOptions,
        `${fieldPath}.options`,
        diagnostics,
      );
      if (
        Array.isArray(field.options) &&
        !field.options.every((option) => typeof option === "string")
      ) {
        diagnostics.push(
          genUIError(
            "GENUI_ARRAY_ITEM_INVALID",
            "Thread GenUI form field options must be strings.",
            `${fieldPath}.options`,
          ),
        );
      }
    }
  });
}

function validateMobileFallback(
  input: unknown,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (!isRecord(input)) {
    diagnostics.push(
      genUIError(
        "GENUI_MOBILE_FALLBACK_REQUIRED",
        "Thread GenUI data must include mobileFallback.",
        "$.data.mobileFallback",
      ),
    );
    return;
  }

  validateUnknownKeys(
    input,
    mobileFallbackKeys,
    "$.data.mobileFallback",
    diagnostics,
  );
  requireString(input, "title", "$.data.mobileFallback", diagnostics);
  requireString(input, "summary", "$.data.mobileFallback", diagnostics);
  if (
    input.lines != null &&
    (!Array.isArray(input.lines) ||
      input.lines.length > threadGenUILimits.maxFallbackLines ||
      !input.lines.every((line) => typeof line === "string"))
  ) {
    diagnostics.push(
      genUIError(
        "GENUI_MOBILE_FALLBACK_LINES_INVALID",
        "Thread GenUI mobileFallback.lines is invalid.",
        "$.data.mobileFallback.lines",
      ),
    );
  }
}

function validateActions(input: unknown, diagnostics: ThreadGenUIDiagnostic[]) {
  if (input == null) return;
  if (!Array.isArray(input)) {
    diagnostics.push(
      genUIError(
        "GENUI_ACTIONS_INVALID",
        "Thread GenUI actions must be an array.",
        "$.data.actions",
      ),
    );
    return;
  }

  if (input.length > threadGenUILimits.maxActions) {
    diagnostics.push(
      genUIError(
        "GENUI_TOO_MANY_ACTIONS",
        `Thread GenUI actions exceed ${threadGenUILimits.maxActions}.`,
        "$.data.actions",
      ),
    );
  }

  const ids = new Set<string>();
  input.forEach((action, index) => {
    const path = `$.data.actions[${index}]`;
    if (!isRecord(action)) {
      diagnostics.push(
        genUIError("GENUI_ACTION_INVALID", "Action must be an object.", path),
      );
      return;
    }
    validateUnknownKeys(action, actionKeys, path, diagnostics);
    requireString(action, "id", path, diagnostics);
    requireString(action, "label", path, diagnostics);
    if (!isThreadGenUIActionKind(action.kind)) {
      diagnostics.push(
        genUIError(
          "GENUI_ACTION_KIND_INVALID",
          "Thread GenUI action kind is unsupported.",
          `${path}.kind`,
        ),
      );
    }
    if (typeof action.id === "string") {
      if (ids.has(action.id)) {
        diagnostics.push(
          genUIError(
            "GENUI_ACTION_ID_DUPLICATE",
            "Thread GenUI action ids must be unique.",
            `${path}.id`,
          ),
        );
      }
      ids.add(action.id);
    }
    if (isRecord(action.params)) {
      if (
        Object.keys(action.params).length > threadGenUILimits.maxActionParams
      ) {
        diagnostics.push(
          genUIError(
            "GENUI_ACTION_PARAMS_TOO_LARGE",
            "Thread GenUI action params exceed the v1 limit.",
            `${path}.params`,
          ),
        );
      }
      for (const [paramKey, paramValue] of Object.entries(action.params)) {
        if (!isPrimitive(paramValue)) {
          diagnostics.push(
            genUIError(
              "GENUI_ACTION_PARAM_INVALID",
              "Thread GenUI action params must contain only JSON primitives.",
              `${path}.params.${paramKey}`,
            ),
          );
        }
      }
    } else if (action.params != null) {
      diagnostics.push(
        genUIError(
          "GENUI_ACTION_PARAMS_INVALID",
          "Thread GenUI action params must be an object.",
          `${path}.params`,
        ),
      );
    }
  });
}

function validatePromotion(
  input: unknown,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (input == null) return;
  if (!isRecord(input)) {
    diagnostics.push(
      genUIError(
        "GENUI_PROMOTION_INVALID",
        "Thread GenUI promotion metadata must be an object.",
        "$.data.promotion",
      ),
    );
    return;
  }
  validateUnknownKeys(input, promotionKeys, "$.data.promotion", diagnostics);
}

function validateDiagnostics(
  input: unknown,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (input == null) return;
  if (!isRecord(input)) {
    diagnostics.push(
      genUIError(
        "GENUI_DIAGNOSTIC_INVALID",
        "Thread GenUI diagnostic must be an object.",
        path,
      ),
    );
    return;
  }
  validateUnknownKeys(input, diagnosticKeys, path, diagnostics);
  requireString(input, "code", path, diagnostics);
  requireString(input, "message", path, diagnostics);
  requireEnum(input, "severity", ["error", "warning"], path, diagnostics);
  if (input.path != null && typeof input.path !== "string") {
    diagnostics.push(
      genUIError(
        "GENUI_DIAGNOSTIC_PATH_INVALID",
        "Thread GenUI diagnostic.path must be a string.",
        `${path}.path`,
      ),
    );
  }
}

function validateDepth(
  root: string,
  elements: Record<string, unknown>,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  const visiting = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (depth > threadGenUILimits.maxElementDepth) {
      diagnostics.push(
        genUIError(
          "GENUI_SPEC_TOO_DEEP",
          `Thread GenUI spec exceeds depth ${threadGenUILimits.maxElementDepth}.`,
          `$.data.spec.elements.${id}`,
        ),
      );
      return;
    }
    if (visiting.has(id)) {
      diagnostics.push(
        genUIError(
          "GENUI_SPEC_CYCLE",
          "Thread GenUI spec cannot contain child cycles.",
          `$.data.spec.elements.${id}`,
        ),
      );
      return;
    }
    const element = elements[id];
    if (!isRecord(element) || !Array.isArray(element.children)) return;
    visiting.add(id);
    for (const childId of element.children) {
      if (typeof childId !== "string" || !(childId in elements)) {
        diagnostics.push(
          genUIError(
            "GENUI_CHILD_MISSING",
            "Thread GenUI child id must reference an element.",
            `$.data.spec.elements.${id}.children`,
          ),
        );
      } else {
        visit(childId, depth + 1);
      }
    }
    visiting.delete(id);
  };
  visit(root, 1);
}

function validateUnknownKeys(
  input: Record<string, unknown>,
  allowedKeys: Set<string>,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push(
        genUIError(
          "GENUI_UNKNOWN_KEY",
          `Unsupported Thread GenUI key ${key}.`,
          `${path}.${key}`,
        ),
      );
    }
  }
}

function collectForbiddenFieldDiagnostics(
  input: unknown,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (Array.isArray(input)) {
    input.forEach((value, index) =>
      collectForbiddenFieldDiagnostics(value, `${path}[${index}]`, diagnostics),
    );
    return;
  }
  if (!isRecord(input)) return;
  for (const [key, value] of Object.entries(input)) {
    if (forbiddenKeys.has(key)) {
      diagnostics.push(
        genUIError(
          key === "url" || key === "href" || key === "src" || key === "mediaUrl"
            ? "GENUI_REMOTE_MEDIA_FORBIDDEN"
            : "GENUI_FORBIDDEN_FIELD",
          `Thread GenUI field ${key} is not allowed in v1.`,
          `${path}.${key}`,
        ),
      );
    }
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      diagnostics.push(
        genUIError(
          "GENUI_REMOTE_MEDIA_FORBIDDEN",
          "Thread GenUI v1 does not allow remote URLs or media fields.",
          `${path}.${key}`,
        ),
      );
    }
    collectForbiddenFieldDiagnostics(value, `${path}.${key}`, diagnostics);
  }
}

function validateSerializedSize(
  input: unknown,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (bytes > threadGenUILimits.maxSerializedPartBytes) {
    diagnostics.push(
      genUIError(
        "GENUI_PAYLOAD_TOO_LARGE",
        `Thread GenUI payload exceeds ${threadGenUILimits.maxSerializedPartBytes} bytes.`,
        path,
      ),
    );
  }
}

function requireString(
  input: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(
      genUIError(
        "GENUI_STRING_REQUIRED",
        `Thread GenUI field ${key} is required.`,
        `${path}.${key}`,
      ),
    );
    return;
  }
  if (value.length > threadGenUILimits.maxTextValueLength) {
    diagnostics.push(
      genUIError(
        "GENUI_STRING_TOO_LONG",
        `Thread GenUI field ${key} is too long.`,
        `${path}.${key}`,
      ),
    );
  }
}

function requireEnum(
  input: Record<string, unknown>,
  key: string,
  values: string[],
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (!values.includes(String(input[key]))) {
    diagnostics.push(
      genUIError(
        "GENUI_ENUM_INVALID",
        `Thread GenUI field ${key} is unsupported.`,
        `${path}.${key}`,
      ),
    );
  }
}

function optionalActionReference(
  input: Record<string, unknown>,
  key: string,
  actionIds: Set<string>,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (input[key] == null) return;
  if (typeof input[key] !== "string" || !actionIds.has(input[key])) {
    diagnostics.push(
      genUIError(
        "GENUI_ACTION_REFERENCE_INVALID",
        `Thread GenUI field ${key} must reference a known action id.`,
        `${path}.${key}`,
      ),
    );
  }
}

function validateBoundedArray(
  input: unknown,
  limit: number,
  path: string,
  diagnostics: ThreadGenUIDiagnostic[],
) {
  if (!Array.isArray(input)) {
    diagnostics.push(
      genUIError(
        "GENUI_ARRAY_REQUIRED",
        "Thread GenUI field must be an array.",
        path,
      ),
    );
    return;
  }
  if (input.length > limit) {
    diagnostics.push(
      genUIError(
        "GENUI_ARRAY_TOO_LONG",
        `Thread GenUI array exceeds limit ${limit}.`,
        path,
      ),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
  return (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
