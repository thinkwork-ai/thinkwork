import { genUIError } from "./diagnostics.js";
import type {
  ThreadGenUIDiagnostic,
  ThreadGenUIElement,
  ThreadGenUIValidationContext,
} from "./spec.js";

export interface ThreadGenUIAdapter {
  component: string;
  validateElement(
    element: ThreadGenUIElement,
    path: string,
  ): ThreadGenUIDiagnostic[];
}

export interface ThreadGenUIAdapterRegistry {
  has(component: string): boolean;
  validateElement(
    component: string,
    element: ThreadGenUIElement,
    path: string,
  ): ThreadGenUIDiagnostic[];
  toValidationContext(): ThreadGenUIValidationContext;
}

export function createThreadGenUIAdapterRegistry(
  adapters: ThreadGenUIAdapter[] = [],
): ThreadGenUIAdapterRegistry {
  const adapterMap = new Map(
    adapters.map((adapter) => [adapter.component, adapter] as const),
  );
  const validateElement = (
    component: string,
    element: ThreadGenUIElement,
    path: string,
  ) => {
    const adapter = adapterMap.get(component);
    if (!adapter) {
      return [
        genUIError(
          "GENUI_ADAPTER_MISSING",
          `No GenUI adapter is registered for ${component}.`,
          path,
        ),
      ];
    }
    return adapter.validateElement(element, path);
  };

  return {
    has(component) {
      return adapterMap.has(component);
    },
    validateElement,
    toValidationContext() {
      return {
        allowAdapterComponents: [...adapterMap.keys()],
        validateAdapterElement: validateElement,
      };
    },
  };
}
