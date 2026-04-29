import { createContextEngineRouter } from "./router.js";
import { synthesizeContextAnswer } from "./synthesis.js";
import {
  ContextEngineValidationError,
  type ContextEngineRequest,
  type ContextEngineResponse,
  type ContextProviderDescriptor,
} from "./types.js";
import { validateContextEngineCaller } from "./caller-scope.js";
import {
  createContextProvidersForCaller,
  createCoreContextProviders,
} from "./providers/index.js";

export interface ContextEngineService {
  query(request: ContextEngineRequest): Promise<ContextEngineResponse>;
  listProviders(args?: {
    caller?: ContextEngineRequest["caller"];
  }): Promise<ContextProviderDescriptor[]>;
}

export function createContextEngineService(
  args: {
    providers?: ContextProviderDescriptor[];
    loadProviders?: (
      caller?: ContextEngineRequest["caller"],
    ) => Promise<ContextProviderDescriptor[]>;
    validateCaller?: typeof validateContextEngineCaller;
  } = {},
): ContextEngineService {
  const staticProviders = args.providers ?? createCoreContextProviders();
  const loadProviders =
    args.loadProviders ??
    (args.providers
      ? async () => staticProviders
      : createContextProvidersForCaller);
  const validateCaller = args.validateCaller ?? validateContextEngineCaller;

  return {
    async query(request) {
      if (!(await validateCaller(request.caller))) {
        throw new ContextEngineValidationError("invalid context engine caller");
      }
      const providers = await loadProviders(request.caller);
      const router = createContextEngineRouter({
        providers,
        synthesize: synthesizeContextAnswer,
      });
      return await router.query(request);
    },
    async listProviders(args) {
      const providers = await loadProviders(args?.caller);
      const router = createContextEngineRouter({
        providers,
        synthesize: synthesizeContextAnswer,
      });
      return router.listProviders();
    },
  };
}

let defaultContextEngineService: ContextEngineService | null = null;

export function getContextEngineService(): ContextEngineService {
  if (!defaultContextEngineService) {
    defaultContextEngineService = createContextEngineService();
  }
  return defaultContextEngineService;
}

export function resetContextEngineServiceForTests(): void {
  defaultContextEngineService = null;
}

export * from "./types.js";
