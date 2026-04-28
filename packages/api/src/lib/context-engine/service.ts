import { createContextEngineRouter } from "./router.js";
import { synthesizeContextAnswer } from "./synthesis.js";
import {
	ContextEngineValidationError,
	type ContextEngineRequest,
	type ContextEngineResponse,
	type ContextProviderDescriptor,
} from "./types.js";
import { validateContextEngineCaller } from "./caller-scope.js";
import { createCoreContextProviders } from "./providers/index.js";

export interface ContextEngineService {
	query(request: ContextEngineRequest): Promise<ContextEngineResponse>;
	listProviders(args?: {
		caller?: ContextEngineRequest["caller"];
	}): Promise<ContextProviderDescriptor[]>;
}

export function createContextEngineService(args: {
	providers?: ContextProviderDescriptor[];
	validateCaller?: typeof validateContextEngineCaller;
} = {}): ContextEngineService {
	const providers = args.providers ?? createCoreContextProviders();
	const validateCaller = args.validateCaller ?? validateContextEngineCaller;
	const router = createContextEngineRouter({
		providers,
		synthesize: synthesizeContextAnswer,
	});

	return {
		async query(request) {
			if (!(await validateCaller(request.caller))) {
				throw new ContextEngineValidationError("invalid context engine caller");
			}
			return await router.query(request);
		},
		async listProviders() {
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
